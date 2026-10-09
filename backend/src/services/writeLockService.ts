// Trava de concorrência real pra padrões "ler última linha / calcular
// próxima linha livre / escrever" em Google Sheets — hoje NENHUM desses
// pontos tinha proteção nenhuma contra duas escritas concorrentes
// calculando a MESMA "próxima linha livre" e colidindo.
//
// Caso real que motivou isto (investigado em 2026, "bug da Rayna"): o
// álbum "AFTERPARTY" da Rayna foi lançado pela Gestão normal
// (createAlbumController -> publicarAlbum) quase ao mesmo tempo em que o
// workflow de migração de álbuns legados (migrarAlbunsLegadosController,
// que TAMBÉM chama publicarAlbum pra cada álbum legado pendente) estava
// rodando. Os dois caminhos convergem no mesmo publicarAlbum, que grava a
// linha do álbum em "Albuns" via appendRow nativo (:append) restrito a
// A:K — o algoritmo de "tabela" do Sheets decide a próxima linha livre
// olhando só esse intervalo, sem nenhuma serialização garantida entre
// duas chamadas de :append praticamente simultâneas no mesmo
// spreadsheet/aba. O resultado observado em "Albuns" linha 100: colunas
// B/D/G (tópico e nome do álbum) com os dados da Rayna, colunas E/F (ID/
// nome do criador) com os dados de OUTRO jogador de uma migração que
// rodava em paralelo, e o Código único (que devia ir pra coluna L via um
// updateValues separado, ver registrarAlbumNaEdicaoChartsAlbuns) parando
// na coluna C (capa) — sinal de que a linha foi, na prática, escrita por
// duas requisições diferentes em momentos próximos, com pelo menos uma
// delas operando sobre um índice de linha que não refletia mais o estado
// real da planilha no momento em que a escrita de fato aconteceu.
//
// withWriteLock(key, fn) serializa qualquer bloco "ler última linha +
// escrever" cuja chave (`key`) identifica a MESMA aba/tabela lógica, usando
// o banco D1 já disponível no projeto (CATALOGO_DB, ver catalogoDbService.ts)
// como trava atômica: um INSERT que viola PRIMARY KEY falha pra quem
// chega depois, igual um mutex de banco de dados de verdade — bem mais
// barato e confiável que qualquer tentativa de lock "no Sheets" (que não
// tem nenhuma primitiva atômica própria pra isso).
//
// Degrada sem travar nada quando o D1 não está disponível (dev local sem
// o binding, por exemplo): roda a função direto, sem lock — mesmo
// comportamento (arriscado) de antes, nunca pior.
import { getCatalogoDb, type D1DatabaseLike } from "./catalogoDbService";

const DEFAULT_TTL_MS = 20_000; // generoso pra um round-trip de Sheets (várias chamadas sequenciais)
const DEFAULT_MAX_TENTATIVAS = 40;
const DEFAULT_ESPERA_MS = 200;

let tabelaGarantida = false;

async function ensureTable(db: D1DatabaseLike): Promise<void> {
  if (tabelaGarantida) return;
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS write_locks (
        lock_key TEXT PRIMARY KEY,
        acquired_at INTEGER NOT NULL
      )`,
    )
    .run();
  tabelaGarantida = true;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Executa `fn` com exclusividade garantida para a chave `key` — nenhuma
// outra chamada concorrente de withWriteLock com a MESMA chave roda `fn`
// ao mesmo tempo (fica esperando até a trava liberar ou expirar).
export async function withWriteLock<T>(
  key: string,
  fn: () => Promise<T>,
  opts?: { ttlMs?: number; maxTentativas?: number },
): Promise<T> {
  const db = getCatalogoDb();
  if (!db) {
    // Sem D1 disponível — segue sem trava (best-effort), nunca bloqueia a
    // escrita real por causa de infraestrutura de lock indisponível.
    return fn();
  }

  const ttlMs = opts?.ttlMs ?? DEFAULT_TTL_MS;
  const maxTentativas = opts?.maxTentativas ?? DEFAULT_MAX_TENTATIVAS;

  await ensureTable(db).catch((err) => {
    console.warn(
      "[writeLockService] Falha ao garantir tabela write_locks — seguindo sem trava:",
      err,
    );
  });

  let adquiriu = false;
  for (let tentativa = 1; tentativa <= maxTentativas && !adquiriu; tentativa++) {
    const agora = Date.now();
    try {
      // Libera qualquer trava EXPIRADA dessa mesma chave antes de tentar
      // (processo anterior pode ter caído sem liberar) — nunca deixa uma
      // chave travada pra sempre por um worker que morreu no meio.
      await db
        .prepare(`DELETE FROM write_locks WHERE lock_key = ? AND acquired_at < ?`)
        .bind(key, agora - ttlMs)
        .run();
      await db
        .prepare(`INSERT INTO write_locks (lock_key, acquired_at) VALUES (?, ?)`)
        .bind(key, agora)
        .run();
      adquiriu = true;
    } catch {
      // INSERT falhou = trava já existe (outra escrita concorrente está
      // dentro do bloco crítico agora) — espera um pouco (com jitter, pra
      // não sincronizar os concorrentes todos no mesmo instante) e tenta
      // de novo.
      await sleep(DEFAULT_ESPERA_MS + Math.random() * DEFAULT_ESPERA_MS);
    }
  }

  if (!adquiriu) {
    throw new Error(
      `[writeLockService] Não foi possível adquirir a trava "${key}" depois de ${maxTentativas} tentativas — outra escrita concorrente está demorando demais ou ficou travada.`,
    );
  }

  try {
    return await fn();
  } finally {
    await db
      .prepare(`DELETE FROM write_locks WHERE lock_key = ?`)
      .bind(key)
      .run()
      .catch((err) => {
        console.warn(
          `[writeLockService] Falha ao liberar a trava "${key}" (vai expirar sozinha pelo TTL):`,
          err,
        );
      });
  }
}

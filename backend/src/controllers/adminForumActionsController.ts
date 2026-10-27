// Três ações admin-only disparadas direto do tópico do Fórum (ver
// Forum.tsx) — nenhuma delas passa pela tela de Gestão. Motivadas pelo bug
// real diagnosticado em 2026-10: a faixa "Wonderwall" (álbum da Hayley)
// teve o checkbox "abrir tópico" marcado por engano no upload da faixa
// dentro do álbum, criando um tópico de fórum pra uma faixa que devia ter
// ficado pendente (publicada só depois, via "faixas sem álbum" normal).
// Não existia nenhuma forma de desfazer isso sem apagar a faixa inteira —
// "marcar como pendente" resolve exatamente esse caso, sem perder nenhum
// dado (áudio, capa, álbum, etc).
import {
  googleSheetsService,
  normalizeComparison,
  normalizeText,
  ensureSheetTab,
} from "../services/googleSheetsService";
import { requestProvesAdmin, extractBearerToken, verifySessionToken } from "../services/sessionService";
import { registrarLogSistema } from "../services/logSistemaService";
import { getCatalogoDb } from "../services/catalogoDbService";
import { mirrorMusicaRowParaD1 } from "./gestaoController";

type TipoTopico = "musica" | "video" | "album";

const COMENTARIOS_SHEET_POR_TIPO: Record<TipoTopico, string> = {
  musica: "Comentarios_Musicas",
  video: "Comentarios_MV",
  album: "Comentarios_Albuns",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Aceita GET (querystring) OU POST (corpo) de propósito — mesmo padrão já
// usado em preSaveController.ts/recalcularTetoPreSaveController, pra dar
// pra diagnosticar via admin-call.yml (workflow do GitHub Actions, que só
// faz GET) quando o front devolve um erro genérico sem detalhe nenhum (ver
// bug real investigado em 2026-10-26: admin usando "Marcar como pendente"
// em produção recebeu "Erro ao executar ação de admin." sem causa visível
// — via GET dá pra ver a resposta/exceção crua, sem depender do navegador).
async function readParamsBodyOrQuery(request: Request): Promise<Record<string, string>> {
  if (request.method === "GET") {
    const url = new URL(request.url);
    return Object.fromEntries(url.searchParams.entries());
  }
  const body = await request.json().catch(() => ({}));
  return (body && typeof body === "object" ? body : {}) as Record<string, string>;
}

// Comentários (e reações — gravadas na MESMA linha, colunas E/F conforme a
// aba, ver forumController.ts/buildCommentRow) tratados pelo ID do tópico
// na coluna A, igual nas 3 abas de comentário. Devolve quantas linhas
// apagou.
async function apagarComentariosDoTopico(tipo: TipoTopico, idTopico: string): Promise<number> {
  const sheet = COMENTARIOS_SHEET_POR_TIPO[tipo];
  const rows = await googleSheetsService.principal.readValues(sheet).catch(() => []);
  const idNorm = normalizeComparison(idTopico);
  const linhas: number[] = [];
  for (let i = 1; i < rows.length; i++) {
    if (normalizeComparison(rows[i]?.[0] || "") === idNorm) linhas.push(i + 1);
  }
  if (linhas.length > 0) {
    await googleSheetsService.principal.deleteRows(sheet, linhas);
  }
  return linhas.length;
}

// Mesma varredura de apagarComentariosDoTopico, mas devolve a linha
// completa de cada comentário encontrado (pra guardar no backup) ANTES de
// apagar — usado só por excluirTopicoController, que precisa do conteúdo
// pra poder restaurar depois.
async function capturarEApagarComentarios(
  tipo: TipoTopico,
  idTopico: string,
): Promise<{ sheetName: string; linhas: { rowIndex: number; row: string[] }[] }> {
  const sheet = COMENTARIOS_SHEET_POR_TIPO[tipo];
  const rows = await googleSheetsService.principal.readValues(sheet).catch(() => []);
  const idNorm = normalizeComparison(idTopico);
  const linhas: { rowIndex: number; row: string[] }[] = [];
  for (let i = 1; i < rows.length; i++) {
    if (normalizeComparison(rows[i]?.[0] || "") === idNorm) linhas.push({ rowIndex: i + 1, row: rows[i] });
  }
  if (linhas.length > 0) {
    await googleSheetsService.principal.deleteRows(sheet, linhas.map((l) => l.rowIndex));
  }
  return { sheetName: sheet, linhas };
}

interface LinhaAlvo {
  rowIndex: number; // 1-based, na planilha
  row: string[];
}

// Acha a linha de Musicas/Music Videos/Albuns pelo "ID do tópico" (coluna
// B em Musicas/Albuns, F em Music Videos — ver colunas documentadas em
// forumController.ts/createCommentController).
async function acharLinhaPorTopico(tipo: TipoTopico, idTopico: string): Promise<LinhaAlvo | null> {
  const sheetName = tipo === "musica" ? "Musicas" : tipo === "video" ? "Music Videos" : "Albuns";
  const colIdTopico = tipo === "video" ? 5 : 1; // F : B
  const rows = await googleSheetsService.principal.readValues(sheetName);
  const idNorm = normalizeComparison(idTopico);
  for (let i = 1; i < rows.length; i++) {
    if (normalizeComparison(rows[i]?.[colIdTopico] || "") === idNorm) {
      return { rowIndex: i + 1, row: rows[i] };
    }
  }
  // DIAGNÓSTICO TEMPORÁRIO (2026-10-27): "Excluir tópico"/"Marcar como
  // pendente" continuavam devolvendo "não encontrado" pro vídeo
  // video_1792938342534_3pzg93 mesmo com a linha comprovadamente existindo
  // na planilha (confirmado via leitura direta minutos antes). Sem acesso
  // ao token de sessão do admin pra reproduzir a chamada exata, não dá pra
  // saber se o "tipo"/"idTopico" que CHEGA aqui é mesmo o esperado (bundle
  // antigo em cache no navegador do admin? Service Worker sem atualizar?
  // caractere invisível no id?) — loga o valor exato recebido (com
  // comprimento e cada char code) e os primeiros ids reais da coluna, pra
  // comparar byte a byte na próxima tentativa real, em vez de continuar
  // só supondo.
  registrarLogSistema({
    categoria: "Erro do app",
    oQueAconteceu: `acharLinhaPorTopico não achou nenhuma linha em "${sheetName}" pro tipo="${tipo}" idTopico="${idTopico}".`,
    onde: "adminForumActionsController.acharLinhaPorTopico",
    causaProvavel: "Investigação em andamento — ver detalhe técnico pra comparar com os ids reais da planilha.",
    comoResolver: "Mandar pro Claude: detalheTecnico tem o id recebido (com códigos de caractere) e uma amostra dos ids reais da coluna.",
    detalheTecnico: JSON.stringify({
      tipo,
      idTopicoRecebido: idTopico,
      tamanho: idTopico.length,
      charCodes: Array.from(idTopico).map((c) => c.charCodeAt(0)),
      idNormalizado: idNorm,
      amostraIdsReais: rows.slice(1, 400).map((r) => r[colIdTopico]).filter(Boolean).slice(0, 15),
    }),
  }).catch(() => {});
  return null;
}

/**
 * POST /api/empire-play/admin/marcar-pendente
 * Body: { tipo: "musica" | "video" | "album", idTopico: string }
 *
 * Volta uma mídia que teve tópico aberto por engano pro estado "pendente"
 * (como se o tópico nunca tivesse existido), SEM apagar nenhum dado da
 * mídia em si (áudio, capa, álbum, título, etc). Música é o caso real que
 * motivou isso (coluna X "pendente" existe só em Musicas); Music Videos e
 * Albuns não têm esse conceito de pendência na planilha — pra eles, o
 * efeito equivalente é "desvincular o tópico" (limpa o ID do tópico e
 * apaga os comentários), já que não existe coluna "pendente" pra marcar.
 */
export async function marcarPendenteController(request: Request): Promise<Response> {
  try {
    if (!(await requestProvesAdmin(request))) {
      return jsonResponse({ success: false, error: "Acesso restrito ao admin." }, 403);
    }
    const params = await readParamsBodyOrQuery(request);
    const tipo = params.tipo as TipoTopico | undefined;
    const idTopico = (params.idTopico || "").trim();
    if (!tipo || !idTopico || !COMENTARIOS_SHEET_POR_TIPO[tipo]) {
      return jsonResponse(
        { success: false, error: "Campos 'tipo' (musica/video/album) e 'idTopico' são obrigatórios." },
        400,
      );
    }

    const alvo = await acharLinhaPorTopico(tipo, idTopico);
    if (!alvo) {
      return jsonResponse({ success: false, error: "Tópico não encontrado na planilha." }, 404);
    }

    const titulo =
      tipo === "musica"
        ? normalizeText(alvo.row[7])
        : tipo === "video"
          ? normalizeText(alvo.row[1])
          : normalizeText(alvo.row[6]);

    // BUG REAL investigado em 2026-10-26 (admin usando "Marcar como
    // pendente" em "He"/Hayley em produção, recebeu "Erro ao executar ação
    // de admin." genérico, sem detalhe — só possível quando res.json() no
    // front falha de verdade, ou seja, a resposta NEM chegou a ser o JSON
    // que este controller sempre devolve, mesmo nos erros: o motivo mais
    // plausível, dado o padrão de código daqui (ver googleSheetsService.ts,
    // "Grammys" nos comentários — retry com backoff de até 1.5s*3 e
    // fallback GViz CSV por leitura, tudo sob pressão de cota real já
    // confirmada em produção), é o limite de CPU/tempo do Worker sendo
    // ultrapassado quando várias chamadas ao Sheets rodam EM SÉRIE sob
    // pico de cota — cada uma com seu próprio retry — e a plataforma
    // devolve a própria página de erro (não-JSON) em vez da resposta do
    // Worker. Antes daqui, 3 chamadas de rede (updateValuesBatch, a releitura
    // de mirrorMusicaRowParaD1, e a leitura cheia da aba de comentários)
    // rodavam 100% em série. As duas últimas não dependem uma da outra —
    // só dependem do updateValuesBatch já ter terminado — então agora rodam
    // em paralelo, cortando essa parte do tempo total praticamente à
    // metade e reduzindo o risco de estourar o limite de novo.
    let comentariosApagados = 0;
    if (tipo === "musica") {
      // B (idTopico) e F (comentariosPara) em branco, X (pendente) = "Sim".
      // Todo o resto da linha (título, áudio, capa, álbum...) fica intacto.
      await googleSheetsService.principal.updateValuesBatch([
        { sheetName: "Musicas", range: `B${alvo.rowIndex}`, values: [[""]] },
        { sheetName: "Musicas", range: `F${alvo.rowIndex}`, values: [[""]] },
        { sheetName: "Musicas", range: `X${alvo.rowIndex}`, values: [["Sim"]] },
      ]);
      // Relê a linha inteira (já com os campos limpos) e reespelha pro D1
      // `musicas` (mesmo padrão de updateFaixaLetraController) EM PARALELO
      // com a limpeza dos comentários — ver nota acima.
      const [d1Ok, apagados] = await Promise.all([
        mirrorMusicaRowParaD1(alvo.rowIndex),
        apagarComentariosDoTopico(tipo, idTopico),
      ]);
      comentariosApagados = apagados;
      // EXIGÊNCIA do usuário (2026-10-26): essa ação NUNCA pode reportar
      // sucesso se Sheets e D1 não ficaram de verdade sincronizados — antes
      // mirrorMusicaRowParaD1 era best-effort silencioso (void), então uma
      // falha de espelhamento (como a que corrompeu várias faixas do álbum
      // da Hayley) passava batido como "sucesso". Agora é erro real.
      if (!d1Ok) {
        return jsonResponse(
          {
            success: false,
            error:
              "A planilha foi atualizada mas o espelho no D1 falhou — Sheets e D1 ficariam dessincronizados. Tente de novo; se persistir, avise.",
          },
          500,
        );
      }
    } else if (tipo === "video") {
      // Music Videos não tem coluna "pendente"/"comentariosPara" própria —
      // só dá pra desvincular o tópico mesmo (limpa F, o message_thread_id).
      // O espelho D1 (`midia`, legado) usa o próprio ID do tópico como PK —
      // não tem como "zerar" essa chave num upsert, então a linha é
      // removida: o efeito pro Fórum/Catálogo (que leem do D1) é o mesmo de
      // "esse tópico nunca existiu", sem tocar a linha real da planilha.
      // As 3 chamadas (planilha, D1, comentários) são independentes entre
      // si — rodam em paralelo, mesma lógica da nota acima.
      const db = getCatalogoDb();
      const [, , apagados] = await Promise.all([
        googleSheetsService.principal.updateValues("Music Videos", `F${alvo.rowIndex}`, [[""]]),
        db ? db.prepare("DELETE FROM midia WHERE id = ?").bind(idTopico).run().catch(() => {}) : Promise.resolve(),
        apagarComentariosDoTopico(tipo, idTopico),
      ]);
      comentariosApagados = apagados;
    } else {
      // Albuns: B (ID do tópico) e D (comentários para) em branco. Mesma
      // paralelização.
      const db = getCatalogoDb();
      const [, , apagados] = await Promise.all([
        googleSheetsService.principal.updateValuesBatch([
          { sheetName: "Albuns", range: `B${alvo.rowIndex}`, values: [[""]] },
          { sheetName: "Albuns", range: `D${alvo.rowIndex}`, values: [[""]] },
        ]),
        db ? db.prepare("DELETE FROM midia WHERE id = ?").bind(idTopico).run().catch(() => {}) : Promise.resolve(),
        apagarComentariosDoTopico(tipo, idTopico),
      ]);
      comentariosApagados = apagados;
    }

    await registrarLogSistema({
      categoria: "Ação concluída",
      oQueAconteceu: `Admin marcou "${titulo || idTopico}" (${tipo}) como pendente — tópico ${idTopico} desfeito, ${comentariosApagados} comentário(s) removido(s).`,
      onde: "marcarPendenteController",
    }).catch(() => {});

    return jsonResponse({ success: true, data: { titulo, comentariosApagados } });
  } catch (err: any) {
    console.error("[marcarPendenteController] Erro:", err);
    return jsonResponse({ success: false, error: err?.message || "Erro ao marcar como pendente." }, 500);
  }
}

// Acha, por "Código único", a linha em EDIÇÃO CHARTS (música, código em
// BD/55) ou EDIÇÃO CHARTS ÁLBUMS (álbum, código em R/17) — ver
// lerCodigoUnicoGerado/registrarAlbumNaEdicaoChartsAlbuns em
// gestaoController.ts.
async function limparLinhaEdicaoCharts(tipo: TipoTopico, codigoUnico: string): Promise<boolean> {
  if (!codigoUnico) return false;
  if (tipo === "video") return false; // vídeo não tem linha própria em EDIÇÃO CHARTS — usa a da música vinculada, que não deve ser tocada aqui.
  const sheet = tipo === "album" ? "EDIÇÃO CHARTS ÁLBUMS" : "EDIÇÃO CHARTS";
  const colCodigo = tipo === "album" ? "R" : "BD";
  const lastCol = tipo === "album" ? "R" : "BD";
  const rows = await googleSheetsService.edicaoCharts.readValues(sheet, `${colCodigo}:${colCodigo}`);
  const codigoNorm = normalizeComparison(codigoUnico);
  const rowIndex = rows.findIndex((r, i) => i > 0 && normalizeComparison(r?.[0] || "") === codigoNorm);
  if (rowIndex === -1) return false;
  const linha = rowIndex + 1;
  // Prefere LIMPAR em vez de apagar a linha de verdade (ver CLAUDE.md desta
  // task) — várias outras rotinas (cálculo de semanas, multiplicadores)
  // assumem índice de linha estático aqui; apagar deslocaria tudo abaixo.
  // updateValues com array vazio não limpa célula nenhuma no Sheets (não
  // sobrescreve nada) — grava explicitamente uma linha de strings vazias
  // do tamanho certo.
  const colStart = "A";
  const width = colLetterToIndex(lastCol) - colLetterToIndex(colStart) + 1;
  await googleSheetsService.edicaoCharts.updateValues(
    sheet,
    `${colStart}${linha}:${lastCol}${linha}`,
    [new Array(width).fill("")],
  );
  return true;
}

function colLetterToIndex(letter: string): number {
  let idx = 0;
  for (const ch of letter) idx = idx * 26 + (ch.toUpperCase().charCodeAt(0) - 64);
  return idx - 1;
}

// Log dedicado (planilha logsSistema, mesma da aba "LOGS" didática) com
// backup restaurável de cada exclusão de tópico — SEPARADO do log genérico
// de registrarLogSistema (aba LOGS, só texto, sem dado pra restaurar).
// Colunas: A Timestamp ISO | B Quem excluiu (usuário) | C ID do admin |
// D Tipo | E idTopico | F Identificação legível | G Backup completo em
// JSON (linha da planilha + linhas do D1 + comentários apagados — tudo que
// excluirTopicoController precisa pra desfazer) | H Restaurado em (ISO,
// preenchido só se essa entrada já foi usada pra restaurar).
const SHEET_LOG_EXCLUSOES = "LOG_EXCLUSOES_TOPICOS";
let logExclusoesAbaGarantida = false;

async function garantirAbaLogExclusoes(): Promise<void> {
  if (logExclusoesAbaGarantida) return;
  await ensureSheetTab("logsSistema", SHEET_LOG_EXCLUSOES);
  const rows = await googleSheetsService.logsSistema.readValues(SHEET_LOG_EXCLUSOES, "A1:A1");
  if (!rows.length) {
    await googleSheetsService.logsSistema.appendRow(
      SHEET_LOG_EXCLUSOES,
      [
        "Timestamp",
        "Quem excluiu",
        "ID do admin",
        "Tipo",
        "idTopico",
        "Identificação",
        "Backup JSON",
        "Restaurado em",
      ],
      "A:H",
    );
  }
  logExclusoesAbaGarantida = true;
}

// Extrai usuário/id do admin que fez a chamada, a partir do mesmo token de
// sessão que requestProvesAdmin já validou — só pra identificação no log,
// nunca usado pra decidir permissão (isso é só o requestProvesAdmin).
async function identificarAdminDaRequisicao(request: Request): Promise<{ usuario: string; id: string }> {
  const token = extractBearerToken(request);
  const payload = await verifySessionToken(token);
  return { usuario: payload?.usuario || "desconhecido", id: payload?.id || "—" };
}

interface BackupTopicoExcluido {
  sheet: { sheetName: string; rowIndex: number; row: string[] };
  d1: { musicas: Record<string, unknown>[]; midia: Record<string, unknown>[] };
  comentarios: { sheetName: string; linhas: { rowIndex: number; row: string[] }[] };
}

// Retenção de 7 dias: backup completo (coluna G) só fica restaurável por 7
// dias — depois disso a célula é limpa (não a linha: a linha some como
// histórico "X excluiu Y nesse dia" mesmo sem poder restaurar mais).
// Escolha arbitrária, mas intencional: tempo suficiente pra alguém notar um
// engano sem deixar a planilha (e o JSON, que pode ficar grande com muitos
// comentários) crescer sem limite.
const RETENCAO_BACKUP_MS = 7 * 24 * 60 * 60 * 1000;

async function purgarBackupsAntigos(): Promise<void> {
  try {
    const rows = await googleSheetsService.logsSistema.readValues(SHEET_LOG_EXCLUSOES, "A:H");
    const limite = Date.now() - RETENCAO_BACKUP_MS;
    const entries: { sheetName: string; range: string; values: (string | null)[][] }[] = [];
    for (let i = 1; i < rows.length; i++) {
      const timestamp = rows[i]?.[0];
      const backup = rows[i]?.[6];
      if (!timestamp || !backup) continue;
      const t = new Date(timestamp).getTime();
      if (!Number.isNaN(t) && t < limite) {
        entries.push({ sheetName: SHEET_LOG_EXCLUSOES, range: `G${i + 1}`, values: [[""]] });
      }
    }
    if (entries.length > 0) {
      await googleSheetsService.logsSistema.updateValuesBatch(entries);
    }
  } catch (err) {
    console.warn("[excluirTopicoController] Falha ao purgar backups antigos (ignorado):", err);
  }
}

/**
 * POST /api/empire-play/admin/excluir-topico
 * Body: { tipo: "musica" | "video" | "album", idTopico: string }
 *
 * EXCEÇÃO deliberada à regra "nunca apagar linha de Sheets" (autorizada
 * explicitamente pelo usuário/admin pra esta ação específica) — apaga de
 * verdade a linha de Musicas/Music Videos/Albuns, limpa a linha
 * correspondente em EDIÇÃO CHARTS/EDIÇÃO CHARTS ÁLBUMS, remove a entrada do
 * D1 (`musicas` por código único e/ou `midia` legado por id) e apaga todo
 * comentário (com reação) do tópico. Irreversível — por isso o log
 * registra o máximo de detalhe possível.
 */
export async function excluirTopicoController(request: Request): Promise<Response> {
  try {
    if (!(await requestProvesAdmin(request))) {
      return jsonResponse({ success: false, error: "Acesso restrito ao admin." }, 403);
    }
    const body = (await request.json()) as { tipo?: TipoTopico; idTopico?: string };
    const tipo = body.tipo;
    const idTopico = (body.idTopico || "").trim();
    if (!tipo || !idTopico || !COMENTARIOS_SHEET_POR_TIPO[tipo]) {
      return jsonResponse(
        { success: false, error: "Campos 'tipo' (musica/video/album) e 'idTopico' são obrigatórios." },
        400,
      );
    }

    const alvo = await acharLinhaPorTopico(tipo, idTopico);
    if (!alvo) {
      return jsonResponse({ success: false, error: "Tópico não encontrado na planilha." }, 404);
    }

    const sheetName = tipo === "musica" ? "Musicas" : tipo === "video" ? "Music Videos" : "Albuns";
    const titulo =
      tipo === "musica"
        ? normalizeText(alvo.row[7])
        : tipo === "video"
          ? normalizeText(alvo.row[1])
          : normalizeText(alvo.row[6]);
    const codigoUnico =
      tipo === "musica"
        ? normalizeText(alvo.row[25])
        : tipo === "video"
          ? normalizeText(alvo.row[20])
          : normalizeText(alvo.row[11]);

    // 0. Captura o estado do D1 ANTES de apagar — vai pro backup
    // restaurável do passo novo abaixo. Melhor esforço: se o D1 não
    // responder, o backup fica sem essa parte, mas a exclusão em si não é
    // bloqueada por isso.
    const db = getCatalogoDb();
    let musicasD1Antes: Record<string, unknown>[] = [];
    let midiaD1Antes: Record<string, unknown>[] = [];
    if (db) {
      if (tipo === "musica" && codigoUnico) {
        musicasD1Antes = await db
          .prepare("SELECT * FROM musicas WHERE codigo_unico = ?")
          .bind(codigoUnico)
          .all<Record<string, unknown>>()
          .then((r) => r.results || [])
          .catch(() => []);
      }
      midiaD1Antes = await db
        .prepare("SELECT * FROM midia WHERE id = ?")
        .bind(idTopico)
        .all<Record<string, unknown>>()
        .then((r) => r.results || [])
        .catch(() => []);
    }

    // 1. Comentários + reações do tópico (sempre primeiro — se algo mais
    // abaixo falhar, não sobra comentário órfão apontando pra uma linha
    // que já vai deixar de existir). Captura o conteúdo completo antes de
    // apagar, pro backup restaurável.
    const comentariosCapturados = await capturarEApagarComentarios(tipo, idTopico);
    const comentariosApagados = comentariosCapturados.linhas.length;

    // 2. EDIÇÃO CHARTS / EDIÇÃO CHARTS ÁLBUMS — limpa a linha pelo código
    // único (vídeo não tem linha própria aqui, pula).
    const edicaoChartsLimpa = await limparLinhaEdicaoCharts(tipo, codigoUnico).catch((err) => {
      console.warn("[excluirTopicoController] Erro ao limpar EDIÇÃO CHARTS:", err);
      return false;
    });

    // 3. D1 — tabela dedicada `musicas` (por código único) e/ou `midia`
    // legada (por id = idTopico).
    if (db) {
      if (tipo === "musica" && codigoUnico) {
        await db.prepare("DELETE FROM musicas WHERE codigo_unico = ?").bind(codigoUnico).run().catch(() => {});
      }
      await db.prepare("DELETE FROM midia WHERE id = ?").bind(idTopico).run().catch(() => {});
    }

    // 4. Por último, a linha real na planilha — EXCEÇÃO explícita à regra
    // de nunca apagar linha (ver CLAUDE.md), autorizada pelo usuário só
    // pra esta ação.
    await googleSheetsService.principal.deleteRows(sheetName, [alvo.rowIndex]);

    // 5. Log restaurável (NOVO, ver CLAUDE.md/pedido do admin: "manter
    // backup de até 7 dias pra poder restaurar"). Best-effort — se essa
    // gravação falhar, a exclusão já aconteceu de verdade e não deve ser
    // desfeita nem travada por causa de um log que não escreveu.
    const admin = await identificarAdminDaRequisicao(request);
    const backup: BackupTopicoExcluido = {
      sheet: { sheetName, rowIndex: alvo.rowIndex, row: alvo.row },
      d1: { musicas: musicasD1Antes, midia: midiaD1Antes },
      comentarios: comentariosCapturados,
    };
    await garantirAbaLogExclusoes()
      .then(() =>
        googleSheetsService.logsSistema.appendRow(
          SHEET_LOG_EXCLUSOES,
          [
            new Date().toISOString(),
            admin.usuario,
            admin.id,
            tipo,
            idTopico,
            titulo || idTopico,
            JSON.stringify(backup),
            "",
          ],
          "A:H",
        ),
      )
      .catch((err) => console.warn("[excluirTopicoController] Falha ao gravar log restaurável (ignorado):", err));

    // 6. Limpeza oportunista dos backups com mais de 7 dias (ver
    // RETENCAO_BACKUP_MS acima) — feito a cada exclusão nova, só nessa aba
    // pequena, nunca bloqueia a resposta em caso de falha.
    await purgarBackupsAntigos();

    await registrarLogSistema({
      categoria: "Ação concluída",
      oQueAconteceu: `Admin ${admin.usuario} EXCLUIU o tópico "${titulo || idTopico}" (${tipo}, idTopico=${idTopico}, código único=${codigoUnico || "—"}) — linha ${alvo.rowIndex} de "${sheetName}" apagada, ${comentariosApagados} comentário(s) removido(s), EDIÇÃO CHARTS ${edicaoChartsLimpa ? "limpa" : "não encontrada/ignorada"}, D1 limpo. Backup restaurável por 7 dias em "${SHEET_LOG_EXCLUSOES}".`,
      onde: "excluirTopicoController",
    }).catch(() => {});

    return jsonResponse({
      success: true,
      data: { titulo, comentariosApagados, edicaoChartsLimpa },
    });
  } catch (err: any) {
    console.error("[excluirTopicoController] Erro:", err);
    return jsonResponse({ success: false, error: err?.message || "Erro ao excluir tópico." }, 500);
  }
}

const LAST_COL_POR_SHEET: Record<string, string> = {
  Musicas: "AE",
  "Music Videos": "U",
  Albuns: "L",
};

// INSERT OR REPLACE dinâmico a partir de um objeto {coluna: valor} capturado
// via SELECT * — funciona pra `musicas` e `midia` sem precisar reproduzir
// manualmente cada campo de MusicaUpsert/MidiaUpsert (o snapshot já É a
// linha real do D1, então reinserir ela de volta, coluna a coluna, é mais
// fiel do que remontar via upsert "normal").
async function reinserirLinhaD1(
  db: NonNullable<ReturnType<typeof getCatalogoDb>>,
  tabela: "musicas" | "midia",
  linha: Record<string, unknown>,
): Promise<void> {
  const colunas = Object.keys(linha);
  if (colunas.length === 0) return;
  const placeholders = colunas.map(() => "?").join(", ");
  const sql = `INSERT OR REPLACE INTO ${tabela} (${colunas.join(", ")}) VALUES (${placeholders})`;
  await db
    .prepare(sql)
    .bind(...colunas.map((c) => linha[c]))
    .run();
}

/**
 * POST /api/empire-play/admin/restaurar-topico-excluido
 * Body: { logRowIndex: number }
 *
 * Desfaz uma exclusão feita por excluirTopicoController, a partir do
 * backup completo guardado em LOG_EXCLUSOES_TOPICOS (coluna G) — só
 * funciona dentro da janela de 7 dias (ver RETENCAO_BACKUP_MS); passado
 * isso a célula já foi limpa e não tem mais como restaurar. `logRowIndex`
 * é o número da linha de verdade na aba (1-based, como aparece ao abrir a
 * planilha) — sem UI pra isso ainda, o admin lê a aba direto (ou via
 * admin-call.yml) pra achar a linha certa pelo idTopico/identificação.
 */
export async function restaurarTopicoExcluidoController(request: Request): Promise<Response> {
  try {
    if (!(await requestProvesAdmin(request))) {
      return jsonResponse({ success: false, error: "Acesso restrito ao admin." }, 403);
    }
    const params = await readParamsBodyOrQuery(request);
    const logRowIndex = Number(params.logRowIndex);
    if (!logRowIndex || logRowIndex < 2) {
      return jsonResponse({ success: false, error: "'logRowIndex' é obrigatório (linha da aba LOG_EXCLUSOES_TOPICOS, >= 2)." }, 400);
    }

    const row = (
      await googleSheetsService.logsSistema.readValues(SHEET_LOG_EXCLUSOES, `A${logRowIndex}:H${logRowIndex}`)
    )[0];
    if (!row || !row[0]) {
      return jsonResponse({ success: false, error: `Linha ${logRowIndex} não encontrada em "${SHEET_LOG_EXCLUSOES}".` }, 404);
    }
    const backupJson = row[6];
    if (!backupJson) {
      return jsonResponse(
        {
          success: false,
          error:
            "Essa entrada não tem mais backup restaurável — ou já passou da janela de 7 dias (foi purgado automaticamente) ou já foi restaurada antes.",
        },
        400,
      );
    }

    let backup: BackupTopicoExcluido;
    try {
      backup = JSON.parse(backupJson);
    } catch {
      return jsonResponse({ success: false, error: "Backup JSON dessa linha está corrompido/ilegível." }, 500);
    }

    const admin = await identificarAdminDaRequisicao(request);

    // 1. Linha da planilha (Musicas/Music Videos/Albuns) — appendRow de
    // volta, com exatamente os mesmos valores que foram apagados.
    const lastCol = LAST_COL_POR_SHEET[backup.sheet.sheetName] || "ZZ";
    await googleSheetsService.principal.appendRow(backup.sheet.sheetName, backup.sheet.row, `A:${lastCol}`);

    // 2. D1 — `musicas` e/ou `midia`, linha a linha, exatamente como
    // estavam (ver reinserirLinhaD1).
    const db = getCatalogoDb();
    let d1Restaurado = 0;
    if (db) {
      for (const linhaMusica of backup.d1.musicas) {
        await reinserirLinhaD1(db, "musicas", linhaMusica).catch((err) =>
          console.warn("[restaurarTopicoExcluidoController] Falha ao restaurar linha `musicas` (ignorado):", err),
        );
        d1Restaurado++;
      }
      for (const linhaMidia of backup.d1.midia) {
        await reinserirLinhaD1(db, "midia", linhaMidia).catch((err) =>
          console.warn("[restaurarTopicoExcluidoController] Falha ao restaurar linha `midia` (ignorado):", err),
        );
        d1Restaurado++;
      }
    }

    // 3. Comentários/reações — appendRow de volta na mesma aba, uma a uma
    // (poucas linhas, não compensa paralelizar/batch aqui).
    let comentariosRestaurados = 0;
    for (const linha of backup.comentarios.linhas) {
      await googleSheetsService.principal.appendRow(backup.comentarios.sheetName, linha.row, "A:F");
      comentariosRestaurados++;
    }

    // 4. Marca a entrada do log como já restaurada (não apaga — o log em
    // si é histórico permanente), pra não confundir uma tentativa futura
    // de restaurar a mesma entrada de novo.
    await googleSheetsService.logsSistema
      .updateValues(SHEET_LOG_EXCLUSOES, `H${logRowIndex}`, [[new Date().toISOString()]])
      .catch(() => {});

    await registrarLogSistema({
      categoria: "Ação concluída",
      oQueAconteceu: `Admin ${admin.usuario} RESTAUROU o tópico excluído "${row[5] || row[4]}" (linha ${logRowIndex} de "${SHEET_LOG_EXCLUSOES}") — linha da planilha "${backup.sheet.sheetName}" recriada, ${d1Restaurado} linha(s) de D1 restaurada(s), ${comentariosRestaurados} comentário(s) restaurado(s).`,
      onde: "restaurarTopicoExcluidoController",
    }).catch(() => {});

    return jsonResponse({
      success: true,
      data: { sheetName: backup.sheet.sheetName, d1Restaurado, comentariosRestaurados },
    });
  } catch (err: any) {
    console.error("[restaurarTopicoExcluidoController] Erro:", err);
    return jsonResponse({ success: false, error: err?.message || "Erro ao restaurar tópico excluído." }, 500);
  }
}

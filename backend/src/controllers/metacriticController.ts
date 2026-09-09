import { sheetsService } from "../services/sheetsService";
import { buildCleanItem } from "./empirePlayController";

// Ranking do "Metacritic" (nota crítica dos jogadores) — antes exibido em
// tempo real no Catálogo (badge em cada música/álbum). A pedido do
// usuário, sai do Catálogo e vira uma aba própria em Acervo, com um
// requisito específico: a atualização precisa ser SEMANAL, não em tempo
// real — pra ninguém conseguir inferir "quem deu nota pra quem" olhando o
// ranking mudar assim que alguém comenta. Por isso isso aqui NUNCA lê a
// planilha na hora que alguém abre a tela (ver getMetacriticRankingController
// nas rotas) — só lê uma vez por semana (rodando junto do cron de 10 min,
// mas só de fato regravando quando a "semana" atual ainda não tem
// snapshot) e guarda um retrato pronto no KV FLAGS, que é só servido como
// está pros jogadores.

interface FlagsKvLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
}

// Mesmo "error-log" (KV FLAGS) já usado por processarParticipacaoTV — dá
// pra checar em /api/debug/error-log sem precisar adivinhar por que a aba
// apareceu vazia da próxima vez.
async function registrarDiagnosticoMetacritic(flags: FlagsKvLike, mensagem: string): Promise<void> {
  try {
    const entry = { ts: Date.now(), source: "metacritic-snapshot", message: mensagem, path: undefined };
    const raw = await flags.get("error-log");
    const list = raw ? JSON.parse(raw) : [];
    list.unshift(entry);
    await flags.put("error-log", JSON.stringify(list.slice(0, 50)));
  } catch {
    // Nunca deixar o log de diagnóstico derrubar a geração em si.
  }
}

export interface MetacriticSnapshotItem {
  id: string;
  tipo: "musicas" | "albuns";
  titulo: string;
  artista: string;
  capaUrl: string | null;
  nota: number;
  genero: string | null;
  releaseDateIso: string | null;
}

interface MetacriticSnapshot {
  semanaId: string;
  geradoEm: string;
  itens: MetacriticSnapshotItem[];
}

const KV_KEY = "metacritic-semanal";
const MAX_ITENS = 150;

// Semana do jogo vira quarta-feira 00:00 (horário de Brasília) — mesmo
// corte que já fecha REGISTRO/pontos da semana (confirmado pelo usuário).
// O id da semana é a data (AAAA-MM-DD) dessa quarta mais recente; enquanto
// o snapshot guardado já for dessa mesma semana, não regrava nada.
function calcularSemanaId(agora = new Date()): string {
  const spAgora = new Date(agora.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  const diasDesdeQuarta = (spAgora.getDay() - 3 + 7) % 7; // quarta-feira = 3
  spAgora.setHours(0, 0, 0, 0);
  spAgora.setDate(spAgora.getDate() - diasDesdeQuarta);
  return spAgora.toISOString().slice(0, 10);
}

function extrairNota(valor: number | string | null | undefined): number | null {
  if (valor === null || valor === undefined || valor === "") return null;
  const num = Number(valor);
  return Number.isFinite(num) && num > 0 ? num : null;
}

async function montarSnapshot(semanaId: string): Promise<MetacriticSnapshot> {
  const [musicasRows, albunsRows] = await Promise.all([
    sheetsService.readSheetObjects("Musicas").catch(() => []),
    sheetsService.readSheetObjects("Albuns").catch(() => []),
  ]);

  const itens: MetacriticSnapshotItem[] = [];

  musicasRows.forEach((rec, idx) => {
    const item = buildCleanItem("Musicas", rec, idx);
    const nota = extrairNota(item.metacriticAvg);
    if (nota === null) return;
    // Linha com nota preenchida mas sem título real (lixo/linha de teste na
    // planilha) — sem isso entrava no ranking como um card em branco (nota
    // aparecendo, resto vazio), reportado pelo usuário.
    if (!item.title?.trim()) return;
    itens.push({
      id: item.id,
      tipo: "musicas",
      titulo: item.title,
      artista: item.displayArtists || item.artist,
      capaUrl: item.coverUrl || null,
      nota,
      genero: item.genero || null,
      releaseDateIso: item.releaseDateIso || null,
    });
  });

  albunsRows.forEach((rec, idx) => {
    const item = buildCleanItem("Albuns", rec, idx);
    const nota = extrairNota(item.metacriticAvg);
    if (nota === null) return;
    if (!item.title?.trim()) return;
    itens.push({
      id: item.id,
      tipo: "albuns",
      titulo: item.title,
      artista: item.displayArtists || item.artist,
      capaUrl: item.coverUrl || null,
      nota,
      genero: item.genero || null,
      releaseDateIso: item.releaseDateIso || null,
    });
  });

  itens.sort((a, b) => b.nota - a.nota);

  return {
    semanaId,
    geradoEm: new Date().toISOString(),
    itens: itens.slice(0, MAX_ITENS),
  };
}

/**
 * Chamado pelo cron de 10 min (ver src/server.ts, handler "scheduled") —
 * só regrava o snapshot quando a "semana" atual (corte de quarta 00:00)
 * ainda não tem um pronto. Nunca lança: um snapshot velho continuar
 * servindo é sempre melhor que a tela quebrar.
 */
export async function atualizarSnapshotMetacriticSemanalScheduled(
  flags?: FlagsKvLike,
): Promise<{ atualizou: boolean; semanaId: string }> {
  const semanaId = calcularSemanaId();
  if (!flags) return { atualizou: false, semanaId };

  try {
    const raw = await flags.get(KV_KEY);
    const atual = raw ? (JSON.parse(raw) as MetacriticSnapshot) : null;
    if (atual?.semanaId === semanaId) {
      return { atualizou: false, semanaId };
    }
    const snapshot = await montarSnapshot(semanaId);
    await flags.put(KV_KEY, JSON.stringify(snapshot));
    if (snapshot.itens.length === 0) {
      // Não é erro (a geração rodou certinho), mas é o motivo mais provável
      // da aba aparecer vazia pro jogador — nenhuma linha de Musicas/Albuns
      // tinha uma nota de Metacritic preenchida na hora da geração. Deixa
      // rastro pra não precisar adivinhar da próxima vez.
      await registrarDiagnosticoMetacritic(
        flags,
        `[metacriticController] Snapshot da semana ${semanaId} gerado com 0 itens — nenhuma linha de Musicas/Albuns tinha nota de Metacritic preenchida no momento da geração.`,
      );
    }
    return { atualizou: true, semanaId };
  } catch (err) {
    console.warn("[metacriticController] Erro ao atualizar snapshot semanal:", err);
    await registrarDiagnosticoMetacritic(
      flags,
      `[metacriticController] Erro ao gerar snapshot da semana ${semanaId}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return { atualizou: false, semanaId };
  }
}

/**
 * POST /api/acervo/metacritic/atualizar — força a geração do snapshot AGORA,
 * ignorando o "já gerado essa semana". Existe só pra popular a aba na
 * primeira vez (sem esperar até 10 min do próximo tick do cron) e pra dar
 * pra forçar uma atualização pontual se precisar — o fluxo normal continua
 * sendo o cron semanal automático.
 */
export async function forcarAtualizacaoMetacriticController(flagsParam?: FlagsKvLike): Promise<Response> {
  const flags = flagsParam || ((globalThis as Record<string, unknown>).__FLAGS_KV__ as FlagsKvLike | undefined);
  if (!flags) {
    return new Response(JSON.stringify({ success: false, error: "KV FLAGS indisponível neste ambiente." }), {
      status: 503,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }
  try {
    const semanaId = calcularSemanaId();
    const snapshot = await montarSnapshot(semanaId);
    await flags.put(KV_KEY, JSON.stringify(snapshot));
    return new Response(JSON.stringify({ success: true, data: { semanaId, totalItens: snapshot.itens.length } }), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  } catch (error: any) {
    return new Response(
      JSON.stringify({ success: false, error: error.message || "Erro ao gerar snapshot do Metacritic." }),
      { status: 500, headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  }
}

/**
 * GET /api/acervo/metacritic — só lê o retrato pronto do KV, nunca a
 * planilha na hora (é exatamente esse o ponto: leve, e sem dar pra
 * ninguém inferir "quem comentou o quê" vendo o ranking mudar ao vivo).
 */
export async function getMetacriticRankingController(flagsParam?: FlagsKvLike): Promise<Response> {
  const flags = flagsParam || ((globalThis as Record<string, unknown>).__FLAGS_KV__ as FlagsKvLike | undefined);
  try {
    if (!flags) {
      return new Response(JSON.stringify({ success: true, data: { semanaId: null, geradoEm: null, itens: [] } }), {
        status: 200,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }
    const raw = await flags.get(KV_KEY);
    const snapshot: MetacriticSnapshot = raw
      ? JSON.parse(raw)
      : { semanaId: null, geradoEm: null, itens: [] };
    return new Response(JSON.stringify({ success: true, data: snapshot }), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  } catch (error: any) {
    return new Response(
      JSON.stringify({ success: false, error: error.message || "Erro ao ler ranking do Metacritic." }),
      { status: 500, headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  }
}

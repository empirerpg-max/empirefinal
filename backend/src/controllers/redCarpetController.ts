import {
  googleSheetsService,
  ensureSheetTab,
  normalizeComparison,
  normalizeText,
} from "../services/googleSheetsService";

// Aba "RED_CARPET_POSTS" na planilha "Empire TV Oficial" (mesma spreadsheet
// de Agenda_TV/Presenca_TV) — criada sob demanda (self-healing, mesmo padrão
// de Notificacoes em notificacoesController.ts). Colunas:
// A=ID, B=Programa/Sala ID, C=Nome do artista, D=Foto do artista,
// E=Fotos (JSON, até 4 URLs), F=Legenda, G=Telegram ID de quem postou,
// H=Data (ISO), I=Curtidas (JSON {likes, likedBy[]} — mesmo formato de
// "analytics" usado em SOCIAL_POSTS, base do ranking do prêmio Gary Lake
// Fashion Carpet).
const SHEET = "RED_CARPET_POSTS";
const HEADER = [
  "ID",
  "Programa ID",
  "Artista",
  "Foto do Artista",
  "Fotos",
  "Legenda",
  "Telegram ID",
  "Data",
  "Curtidas",
];
const MAX_FOTOS = 4;

interface CurtidasJson {
  likes: number;
  likedBy: string[];
}

function parseCurtidas(raw: string | undefined): CurtidasJson {
  try {
    const parsed = JSON.parse(raw || "{}");
    return {
      likes: typeof parsed.likes === "number" ? parsed.likes : 0,
      likedBy: Array.isArray(parsed.likedBy) ? parsed.likedBy : [],
    };
  } catch {
    return { likes: 0, likedBy: [] };
  }
}

let sheetReady = false;
async function ensureRedCarpetSheet(): Promise<void> {
  if (sheetReady) return;
  await ensureSheetTab("agendaTV", SHEET);
  const first = await googleSheetsService.agendaTV.readValues(SHEET, "A1:A1");
  if (!first?.[0]?.[0]?.trim()) {
    await googleSheetsService.agendaTV.updateValues(SHEET, "A1:I1", [HEADER]);
  }
  sheetReady = true;
}

interface RedCarpetPost {
  id: string;
  programaId: string;
  artista: string;
  artistaFoto: string;
  fotos: string[];
  legenda: string;
  telegramId: string;
  data: string;
  likes: number;
}

function rowToPost(row: string[]): RedCarpetPost | null {
  const id = (row[0] || "").trim();
  if (!id) return null;
  let fotos: string[] = [];
  try {
    const parsed = JSON.parse(row[4] || "[]");
    if (Array.isArray(parsed)) fotos = parsed.filter((f) => typeof f === "string" && f.trim());
  } catch {
    fotos = [];
  }
  return {
    id,
    programaId: row[1] || "",
    artista: normalizeText(row[2]),
    artistaFoto: row[3] || "",
    fotos,
    legenda: normalizeText(row[5]),
    telegramId: row[6] || "",
    data: row[7] || "",
    likes: parseCurtidas(row[8]).likes,
  };
}

/**
 * GET /api/tv/red-carpet?programaId=...
 * Feed de fotos do Red Carpet de uma sala específica, mais recentes primeiro.
 */
export async function getRedCarpetFeedController(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const programaId = (url.searchParams.get("programaId") || "").trim();
    if (!programaId) {
      return new Response(JSON.stringify({ success: false, error: "programaId é obrigatório." }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    await ensureRedCarpetSheet();
    const rows = await googleSheetsService.agendaTV.readValues(SHEET).catch(() => []);
    const normPrograma = normalizeComparison(programaId);
    const posts = (rows.length > 1 ? rows.slice(1) : [])
      .map(rowToPost)
      .filter((p): p is RedCarpetPost => !!p && normalizeComparison(p.programaId) === normPrograma)
      .reverse();

    return new Response(JSON.stringify({ success: true, data: posts }), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  } catch (error: any) {
    console.error("[getRedCarpetFeedController] Erro:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message || "Erro ao buscar o feed do Red Carpet." }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}

/**
 * POST /api/tv/red-carpet
 * body: { programaId, artista, artistaFoto, fotos: string[], legenda, telegramId }
 * Publica uma entrada no Red Carpet da sala. O aviso no Chat ("Artista
 * chegou ao Programa") é disparado pelo próprio frontend logo após o
 * sucesso desta chamada (o chat da Empire TV vive no Supabase, não nas
 * planilhas — não há cliente Supabase no backend hoje).
 */
export async function createRedCarpetPostController(request: Request): Promise<Response> {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      programaId?: string;
      artista?: string;
      artistaFoto?: string;
      fotos?: string[];
      legenda?: string;
      telegramId?: string;
    };

    const programaId = (body.programaId || "").trim();
    const artista = (body.artista || "").trim();
    const telegramId = (body.telegramId || "").trim();
    const fotos = Array.isArray(body.fotos)
      ? body.fotos.filter((f) => typeof f === "string" && f.trim()).slice(0, MAX_FOTOS)
      : [];

    if (!programaId || !artista || !telegramId) {
      return new Response(
        JSON.stringify({ success: false, error: "programaId, artista e telegramId são obrigatórios." }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }
    if (fotos.length === 0) {
      return new Response(JSON.stringify({ success: false, error: "Envie ao menos 1 foto." }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    await ensureRedCarpetSheet();
    const id = `RC-${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const nowIso = new Date().toISOString();

    const linhaGravada = await googleSheetsService.agendaTV.appendRow(
      SHEET,
      [
        id,
        programaId,
        artista,
        body.artistaFoto || "",
        JSON.stringify(fotos),
        (body.legenda || "").trim(),
        telegramId,
        nowIso,
        JSON.stringify({ likes: 0, likedBy: [] }),
      ],
      "A:I",
    );
    if (linhaGravada === null) {
      return new Response(
        JSON.stringify({ success: false, error: "Não deu pra salvar a publicação. Tente de novo." }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }

    const post: RedCarpetPost = {
      id,
      programaId,
      artista,
      artistaFoto: body.artistaFoto || "",
      fotos,
      legenda: (body.legenda || "").trim(),
      telegramId,
      data: nowIso,
      likes: 0,
    };

    return new Response(JSON.stringify({ success: true, data: post }), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  } catch (error: any) {
    console.error("[createRedCarpetPostController] Erro:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message || "Erro ao publicar no Red Carpet." }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}

/**
 * POST /api/tv/red-carpet/curtir { postId, tgId }
 * Mesmo padrão de curtirSocialPostController: 1 curtida por jogador por
 * post, controlada dentro do próprio JSON de curtidas (sem aba auxiliar).
 */
export async function curtirRedCarpetPostController(request: Request): Promise<Response> {
  try {
    const body = (await request.json().catch(() => ({}))) as { postId?: string; tgId?: string };
    const postId = (body.postId || "").trim();
    if (!postId) {
      return new Response(JSON.stringify({ success: false, error: "postId é obrigatório." }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    await ensureRedCarpetSheet();
    const rows = await googleSheetsService.agendaTV.readValues(SHEET);
    const rowIndex = rows.findIndex((row, i) => i > 0 && (row[0] || "").trim() === postId);
    if (rowIndex === -1) {
      return new Response(JSON.stringify({ success: false, error: "Post não encontrado." }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    const curtidas = parseCurtidas(rows[rowIndex][8]);
    const tgId = normalizeComparison(body.tgId || "");
    const jaCurtiu = !!tgId && curtidas.likedBy.some((id) => normalizeComparison(id) === tgId);
    if (!jaCurtiu) {
      curtidas.likes += 1;
      if (tgId) curtidas.likedBy = [...curtidas.likedBy, body.tgId!.trim()];
    }

    await googleSheetsService.agendaTV.updateValues(SHEET, `I${rowIndex + 1}`, [[JSON.stringify(curtidas)]]);

    return new Response(JSON.stringify({ success: true, likes: curtidas.likes }), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  } catch (error: any) {
    console.error("[curtirRedCarpetPostController] Erro:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message || "Erro ao curtir o look." }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}

/**
 * GET /api/tv/red-carpet/ranking?programaId=...&limit=20
 * Ranking dos looks mais curtidos — base do prêmio "Gary Lake Fashion
 * Carpet". Sem programaId, ranqueia entre TODOS os programas já registrados
 * (ranking geral da temporada); com programaId, ranqueia só aquela sala.
 */
export async function getRedCarpetRankingController(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const programaId = (url.searchParams.get("programaId") || "").trim();
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 20, 1), 100);

    await ensureRedCarpetSheet();
    const rows = await googleSheetsService.agendaTV.readValues(SHEET).catch(() => []);
    const normPrograma = normalizeComparison(programaId);

    const posts = (rows.length > 1 ? rows.slice(1) : [])
      .map(rowToPost)
      .filter((p): p is RedCarpetPost => !!p && (!programaId || normalizeComparison(p.programaId) === normPrograma))
      .sort((a, b) => b.likes - a.likes)
      .slice(0, limit);

    return new Response(JSON.stringify({ success: true, data: posts }), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  } catch (error: any) {
    console.error("[getRedCarpetRankingController] Erro:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message || "Erro ao buscar o ranking do Red Carpet." }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}

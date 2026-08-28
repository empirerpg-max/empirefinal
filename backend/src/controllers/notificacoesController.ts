import {
  googleSheetsService,
  ensureSheetTab,
  normalizeComparison,
  normalizeText,
} from "../services/googleSheetsService";

// Aba "Notificacoes" na planilha principal — criada sob demanda (self-healing,
// mesmo padrão de REACTION_COLUMN em forumController.ts). Colunas:
// A=ID, B=ID do dono, C=ID do autor, D=Nome do autor, E=Tipo de mídia,
// F=Título, G=ID do tópico, H=Trecho do comentário, I=Data, J=Lida.
const NOTIF_SHEET = "Notificacoes";
const NOTIF_HEADER = [
  "ID",
  "ID do dono",
  "ID do autor",
  "Nome do autor",
  "Tipo",
  "Título",
  "ID do tópico",
  "Comentário",
  "Data",
  "Lida",
];

// Memoiza "a aba já existe/tem cabeçalho" por isolate do Worker — sem isso,
// TODO comentário do app inteiro (música, vídeo, álbum) pagava 2 idas extra
// à API do Sheets (listSheetTabs + leitura do cabeçalho) só pra confirmar
// algo que, depois da primeira vez, nunca muda. Contribuía sozinho pra
// deixar o comentário em vídeo mais lento (~5-6s medidos ao vivo).
let notifSheetReady = false;

async function ensureNotifSheet(): Promise<void> {
  if (notifSheetReady) return;
  await ensureSheetTab("principal", NOTIF_SHEET);
  const first = await googleSheetsService.principal.readValues(NOTIF_SHEET, "A1:A1");
  if (!first?.[0]?.[0]?.trim()) {
    await googleSheetsService.principal.updateValues(NOTIF_SHEET, "A1:J1", [NOTIF_HEADER]);
  }
  notifSheetReady = true;
}

export interface RegistrarNotificacaoComentarioParams {
  ownerId: string;
  autorId: string;
  autorNome: string;
  tipoMedia: string;
  tituloMedia: string;
  topicId: string;
  comentario: string;
}

/**
 * Registra a notificação de "alguém comentou seu tópico" — nunca lança: uma
 * falha aqui não pode derrubar o comentário em si (é chamada de dentro do
 * try/catch de createCommentController, mas fica defensiva por conta
 * própria também, já que outros pontos podem vir a chamá-la no futuro).
 */
export async function registrarNotificacaoComentario(
  params: RegistrarNotificacaoComentarioParams,
): Promise<void> {
  const { ownerId, autorId, autorNome, tipoMedia, tituloMedia, topicId, comentario } = params;
  const ownerClean = (ownerId || "").trim();
  const autorClean = (autorId || "").trim();
  if (!ownerClean || !autorClean || ownerClean === autorClean) return;

  try {
    await ensureNotifSheet();
    const nowStr = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
    const id = `N${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const trechoComentario =
      comentario.length > 140 ? `${comentario.slice(0, 140).trim()}…` : comentario;
    await googleSheetsService.principal.appendRow(NOTIF_SHEET, [
      id,
      ownerClean,
      autorClean,
      autorNome,
      tipoMedia,
      tituloMedia,
      topicId,
      trechoComentario,
      nowStr,
      "FALSE",
    ]);
  } catch (err) {
    console.warn("[notificacoesController] Falha ao registrar notificação:", err);
  }
}

/**
 * GET /api/notificacoes?tgId=...
 * Devolve as notificações do dono (mais recentes primeiro, até 50) + a
 * contagem de não lidas.
 */
export async function getNotificacoesController(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const tgId = (url.searchParams.get("tgId") || "").trim();
    if (!tgId) {
      return new Response(JSON.stringify({ success: false, error: "tgId é obrigatório." }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const rows = await googleSheetsService.principal.readValues(NOTIF_SHEET).catch(() => []);
    const normTg = normalizeComparison(tgId);

    const items = (rows.length > 1 ? rows.slice(1) : [])
      .map((r) => ({
        id: r[0] || "",
        ownerId: r[1] || "",
        autorId: r[2] || "",
        autorNome: normalizeText(r[3]),
        tipoMedia: r[4] || "",
        tituloMedia: normalizeText(r[5]),
        topicId: r[6] || "",
        comentario: normalizeText(r[7]),
        data: r[8] || "",
        lida: (r[9] || "").trim().toUpperCase() === "TRUE",
      }))
      .filter((n) => n.id && normalizeComparison(n.ownerId) === normTg)
      .reverse()
      .slice(0, 50);

    const unreadCount = items.filter((n) => !n.lida).length;

    return new Response(JSON.stringify({ success: true, data: { items, unreadCount } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("[getNotificacoesController] Erro:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message || "Erro ao buscar notificações." }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}

/**
 * POST /api/notificacoes/marcar-lidas { tgId }
 * Marca todas as notificações não lidas do dono como lidas — chamado ao
 * abrir o painel do sininho.
 */
export async function marcarNotificacoesLidasController(request: Request): Promise<Response> {
  try {
    const body = (await request.json().catch(() => ({}))) as { tgId?: string };
    const tgId = (body.tgId || "").trim();
    if (!tgId) {
      return new Response(JSON.stringify({ success: false, error: "tgId é obrigatório." }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const rows = await googleSheetsService.principal.readValues(NOTIF_SHEET).catch(() => []);
    const normTg = normalizeComparison(tgId);

    const updates: Promise<unknown>[] = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const ownerId = row[1] || "";
      const lida = (row[9] || "").trim().toUpperCase() === "TRUE";
      if (!lida && normalizeComparison(ownerId) === normTg) {
        updates.push(
          googleSheetsService.principal.updateValues(NOTIF_SHEET, `J${i + 1}`, [["TRUE"]]),
        );
      }
    }
    await Promise.all(updates);

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("[marcarNotificacoesLidasController] Erro:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message || "Erro ao marcar notificações como lidas." }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}

import { getOwnerIdForArtist } from "./artistasController";
import { getCatalogoDb } from "../services/catalogoDbService";
import {
  appendRows,
  googleSheetsService,
  ensureSheetTab,
  normalizeComparison,
  normalizeText,
} from "../services/googleSheetsService";
import {
  enviarPushParaUsuario,
  adicionarInscricao,
  removerInscricao,
  temInscricao,
  lerPreferencias,
  gravarPreferencias,
  getVapidPublicKey,
  pushConfigurado,
  type TipoNotificacao,
  type PushSubscriptionJson,
  type NotifPrefs,
} from "../services/webPushService";

// Aba "Notificacoes" na planilha principal — criada sob demanda (self-healing,
// mesmo padrão de REACTION_COLUMN em forumController.ts). Colunas:
// A=ID, B=ID do dono, C=ID do autor, D=Nome do autor, E=Tipo de mídia,
// F=Título, G=ID do tópico, H=Trecho do comentário, I=Data, J=Lida,
// K=Evento (coluna nova: "comentario_forum" | "curtida_social" |
// "comentario_social" — linhas antigas ficam vazias e são tratadas como
// "comentario_forum", o único evento que existia antes).
// Pra eventos do Empire Social: E="social", F=trecho da publicação,
// G=id do post (link /social?postId=...).
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
  "Evento",
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
  const first = await googleSheetsService.principal.readValues(NOTIF_SHEET, "A1:K1");
  if (!first?.[0]?.[0]?.trim() || !first?.[0]?.[10]?.trim()) {
    await googleSheetsService.principal.updateValues(NOTIF_SHEET, "A1:K1", [NOTIF_HEADER]);
  }
  notifSheetReady = true;
}

export interface RegistrarNotificacaoParams {
  evento: TipoNotificacao;
  ownerId: string;
  autorId: string;
  autorNome: string;
  tipoMedia: string;
  tituloMedia: string;
  topicId: string;
  comentario: string;
}

const FORUM_TAB_BY_TIPO: Record<string, string> = {
  musica: "musicas",
  album: "albuns",
  video: "videos",
  "music-video": "videos",
};

function truncar(texto: string, max: number): string {
  const t = (texto || "").trim();
  return t.length > max ? `${t.slice(0, max).trim()}…` : t;
}

function montarPush(params: RegistrarNotificacaoParams): {
  title: string;
  body: string;
  url: string;
  tag: string;
} {
  const { evento, autorNome, tipoMedia, tituloMedia, topicId, comentario } = params;
  if (evento === "curtida_social") {
    return {
      title: "❤️ Nova curtida",
      body: tituloMedia
        ? `${autorNome} curtiu sua publicação: "${truncar(tituloMedia, 80)}"`
        : `${autorNome} curtiu sua publicação`,
      url: `/social?postId=${encodeURIComponent(topicId)}`,
      tag: `curtida-${topicId}`,
    };
  }
  if (evento === "comentario_social") {
    return {
      title: "💬 Novo comentário",
      body: `${autorNome} comentou sua publicação: "${truncar(comentario, 100)}"`,
      url: `/social?postId=${encodeURIComponent(topicId)}`,
      tag: `comentario-social-${topicId}`,
    };
  }
  const tab = FORUM_TAB_BY_TIPO[tipoMedia] || "musicas";
  return {
    title: "💬 Novo comentário",
    body: `${autorNome} comentou ${tituloMedia}: "${truncar(comentario, 100)}"`,
    url: `/empire-play/forum?tab=${tab}&id=${encodeURIComponent(topicId)}`,
    tag: `comentario-forum-${topicId}`,
  };
}

/**
 * Registra uma notificação pro dono (sininho) e manda o push pro celular
 * dele, se ativado e se esse tipo estiver ligado nas preferências — nunca
 * lança: uma falha aqui não pode derrubar a ação que originou a notificação
 * (comentário, curtida). Nunca notifica alguém de uma ação própria.
 */
export async function registrarNotificacao(params: RegistrarNotificacaoParams): Promise<void> {
  const ownerClean = (params.ownerId || "").trim();
  const autorClean = (params.autorId || "").trim();
  if (!ownerClean || !autorClean || ownerClean === autorClean) return;

  try {
    await ensureNotifSheet();
    const nowStr = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
    const id = `N${Date.now()}${Math.floor(Math.random() * 1000)}`;
    await googleSheetsService.principal.appendRow(NOTIF_SHEET, [
      id,
      ownerClean,
      autorClean,
      params.autorNome,
      params.tipoMedia,
      truncar(params.tituloMedia, 140),
      params.topicId,
      truncar(params.comentario, 140),
      nowStr,
      "FALSE",
      params.evento,
    ]);
  } catch (err) {
    console.warn("[notificacoesController] Falha ao registrar notificação:", err);
  }

  await enviarPushParaUsuario(ownerClean, params.evento, montarPush(params));
}

export type RegistrarNotificacaoComentarioParams = Omit<RegistrarNotificacaoParams, "evento">;

/** Atalho mantido pro fórum (comentário em música/álbum/vídeo). */
export async function registrarNotificacaoComentario(
  params: RegistrarNotificacaoComentarioParams,
): Promise<void> {
  await registrarNotificacao({ ...params, evento: "comentario_forum" });
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
        evento: (r[10] || "").trim() || "comentario_forum",
      }))
      .map((n, i) => ({ n, i }))
      .filter(({ n }) => n.id && normalizeComparison(n.ownerId) === normTg)
      // Mais recentes primeiro pela DATA (não pela posição na aba): as
      // notificações retroativas (backfill do fórum) entram no fim da aba
      // mas com a data original do comentário.
      .sort((a, b) => parseDataBR(b.n.data) - parseDataBR(a.n.data) || b.i - a.i)
      .map(({ n }) => n)
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

// -------------------- Push no celular + preferências --------------------

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * GET /api/notificacoes/preferencias?tgId=...&endpoint=...
 * Devolve as preferências por tipo, a chave pública VAPID (pro navegador se
 * inscrever) e se ESTE aparelho (endpoint) já está inscrito.
 */
export async function getPreferenciasNotificacaoController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const tgId = (url.searchParams.get("tgId") || "").trim();
  if (!tgId) return json({ success: false, error: "tgId é obrigatório." }, 400);
  const endpoint = (url.searchParams.get("endpoint") || "").trim();
  const [prefs, inscrito, pushDisponivel, vapidPublicKey] = await Promise.all([
    lerPreferencias(tgId),
    endpoint ? temInscricao(tgId, endpoint) : Promise.resolve(false),
    pushConfigurado(),
    getVapidPublicKey(),
  ]);
  return json({
    success: true,
    data: {
      prefs,
      pushDisponivel,
      vapidPublicKey,
      inscrito,
    },
  });
}

/** POST /api/notificacoes/preferencias { tgId, prefs } */
export async function salvarPreferenciasNotificacaoController(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as { tgId?: string; prefs?: Partial<NotifPrefs> };
  const tgId = (body.tgId || "").trim();
  if (!tgId) return json({ success: false, error: "tgId é obrigatório." }, 400);
  const prefs = await gravarPreferencias(tgId, body.prefs || {});
  return json({ success: true, data: { prefs } });
}

/** POST /api/notificacoes/push/inscrever { tgId, subscription } */
export async function inscreverPushController(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as {
    tgId?: string;
    subscription?: PushSubscriptionJson;
  };
  const tgId = (body.tgId || "").trim();
  const sub = body.subscription;
  if (!tgId || !sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
    return json({ success: false, error: "Inscrição inválida." }, 400);
  }
  if (!/^https:\/\//.test(sub.endpoint)) return json({ success: false, error: "Endpoint inválido." }, 400);
  if (!(await pushConfigurado())) {
    return json({ success: false, error: "Notificações no celular ainda não foram configuradas no servidor." }, 503);
  }
  await adicionarInscricao(tgId, sub);
  return json({ success: true });
}

/** POST /api/notificacoes/push/desinscrever { tgId, endpoint } */
export async function desinscreverPushController(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as { tgId?: string; endpoint?: string };
  const tgId = (body.tgId || "").trim();
  const endpoint = (body.endpoint || "").trim();
  if (!tgId || !endpoint) return json({ success: false, error: "tgId e endpoint são obrigatórios." }, 400);
  await removerInscricao(tgId, endpoint);
  return json({ success: true });
}

/**
 * GET /api/notificacoes/admin/diag?n=30
 * Diagnóstico read-only: cabeçalho, total de linhas e as últimas N linhas da
 * aba Notificacoes (pra conferir se cada tipo de evento segue sendo gravado).
 */
export async function diagNotificacoesController(request: Request): Promise<Response> {
  const n = Math.min(100, Math.max(1, Number(new URL(request.url).searchParams.get("n")) || 30));
  const rows = await googleSheetsService.principal.readValues(NOTIF_SHEET).catch((e) => {
    return [["ERRO", String((e as Error)?.message || e)]];
  });
  const porEvento: Record<string, { total: number; ultimaData: string }> = {};
  for (const r of rows.slice(1)) {
    const ev = (r[10] || "").trim() || "(vazio=comentario_forum)";
    porEvento[ev] = { total: (porEvento[ev]?.total || 0) + 1, ultimaData: r[8] || "" };
  }
  return json({
    success: true,
    cabecalho: rows[0] || [],
    totalLinhas: Math.max(0, rows.length - 1),
    porEvento,
    ultimas: rows.slice(-n).map((r) => [r[0], r[3], r[4], (r[5] || "").slice(0, 40), r[8], r[9], r[10]]),
  });
}

// "17/11/2026, 10:03:00" / "17/11/2026 10:03" -> epoch ms (0 se não der).
function parseDataBR(data: string): number {
  const m = (data || "").match(/(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[,\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return 0;
  const [, d, mo, y, h = "0", mi = "0", se = "0"] = m;
  return Date.UTC(+y, +mo - 1, +d, +h, +mi, +se);
}

/**
 * GET /api/notificacoes/admin/backfill-forum?desde=01/11/2026[&confirmar=1]
 * Notificações RETROATIVAS de comentários no fórum: varre as 3 abas de
 * comentário (músicas, álbuns, vídeos) a partir de `desde`, descobre o dono
 * do artista de cada tópico e cria a notificação que faltou no sininho
 * (com a data original do comentário). Nunca duplica: pula o que já existe
 * (mesmo dono + autor + tópico + começo do comentário). Sem `confirmar=1`
 * só simula e mostra o que faria. Não manda push (seria spam de coisa
 * antiga) e entra como não lida.
 */
export async function backfillNotificacoesForumController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const desdeStr = (url.searchParams.get("desde") || "").trim();
  const desde = parseDataBR(desdeStr);
  if (!desde) return json({ success: false, error: "Informe desde=dd/mm/aaaa." }, 400);
  const confirmar = url.searchParams.get("confirmar") === "1";

  await ensureNotifSheet();
  const notifRows = await googleSheetsService.principal.readValues(NOTIF_SHEET).catch(() => []);
  const chave = (owner: string, autor: string, topic: string, coment: string) =>
    [owner, autor, topic, coment.replace(/…$/, "").slice(0, 60)].map((x) => normalizeComparison(x || "")).join("|");
  const existentes = new Set(notifRows.slice(1).map((r) => chave(r[1], r[2], r[6], r[7] || "")));

  // Mapa tópico -> { título, artista } por tipo de mídia.
  type Info = { titulo: string; artista: string };
  const fromTitulo = (t: string): Info => {
    const sep = t.indexOf(" - ");
    return { titulo: t, artista: sep >= 0 ? t.slice(0, sep).trim() : "" };
  };
  const [musicas, albuns, mvs, cMus, cAlb, cMv] = await Promise.all([
    googleSheetsService.principal.readValues("Musicas").catch(() => []),
    googleSheetsService.principal.readValues("Albuns").catch(() => []),
    googleSheetsService.principal.readValues("Music Videos").catch(() => []),
    googleSheetsService.principal.readValues("Comentarios_Musicas").catch(() => []),
    googleSheetsService.principal.readValues("Comentarios_Albuns").catch(() => []),
    googleSheetsService.principal.readValues("Comentarios_MV").catch(() => []),
  ]);
  const mapaMus = new Map<string, Info>();
  for (const r of musicas.slice(1)) {
    const t = normalizeText(r[1]);
    if (t) mapaMus.set(t, { titulo: normalizeText(r[7]), artista: normalizeText(r[13]) });
  }
  const mapaAlb = new Map<string, Info>();
  for (const r of albuns.slice(1)) {
    const t = normalizeText(r[1]);
    if (t) mapaAlb.set(t, fromTitulo(normalizeText(r[6])));
  }
  const mapaMv = new Map<string, Info>();
  for (const r of mvs.slice(1)) {
    const t = normalizeText(r[5]);
    if (t) mapaMv.set(t, fromTitulo(normalizeText(r[1])));
  }

  // Músicas que só existem no D1 (mesmo fallback do createCommentController).
  const db = getCatalogoDb();
  const buscarMusicaD1 = async (topic: string): Promise<Info | undefined> => {
    if (!db) return undefined;
    const res = await db
      .prepare("SELECT titulo, artista FROM musicas WHERE id_topico = ? LIMIT 1")
      .bind(topic)
      .all<{ titulo: string; artista: string }>()
      .catch(() => null);
    const row = res?.results?.[0];
    return row ? { titulo: normalizeText(row.titulo), artista: normalizeText(row.artista) } : undefined;
  };

  const fontes = [
    { tipoMedia: "musica", rows: cMus, colData: 5, mapa: mapaMus },
    { tipoMedia: "album", rows: cAlb, colData: 4, mapa: mapaAlb },
    { tipoMedia: "music-video", rows: cMv, colData: 4, mapa: mapaMv },
  ];

  const ownerCache = new Map<string, string>();
  const novas: string[][] = [];
  const semArtista: string[] = [];
  let analisados = 0;
  let jaExistiam = 0;
  let semDono = 0;
  let base = Date.now();

  for (const f of fontes) {
    for (const r of f.rows.slice(1)) {
      const topic = normalizeText(r[0]);
      const autorId = normalizeText(r[1]);
      const autorNome = normalizeText(r[2]);
      const comentario = normalizeText(r[3]);
      const data = normalizeText(r[f.colData]);
      if (!topic || !autorId || !comentario || parseDataBR(data) < desde) continue;
      analisados++;

      let info = f.mapa.get(topic);
      if ((!info || !info.artista) && f.tipoMedia === "musica") {
        info = (await buscarMusicaD1(topic)) || info;
        if (info) f.mapa.set(topic, info);
      }
      if (!info?.artista) {
        if (semArtista.length < 30) semArtista.push(`${f.tipoMedia}:${topic}`);
        continue;
      }
      const artKey = normalizeComparison(info.artista);
      if (!ownerCache.has(artKey)) ownerCache.set(artKey, await getOwnerIdForArtist(info.artista).catch(() => ""));
      const ownerId = (ownerCache.get(artKey) || "").trim();
      if (!ownerId) {
        semDono++;
        continue;
      }
      if (normalizeComparison(ownerId) === normalizeComparison(autorId)) continue;

      const trecho = comentario.length > 140 ? `${comentario.slice(0, 140).trim()}…` : comentario;
      const k = chave(ownerId, autorId, topic, trecho);
      if (existentes.has(k)) {
        jaExistiam++;
        continue;
      }
      existentes.add(k);
      novas.push([
        `N${base++}${Math.floor(Math.random() * 1000)}`,
        ownerId,
        autorId,
        autorNome,
        f.tipoMedia,
        info.titulo || topic,
        topic,
        trecho,
        data,
        "FALSE",
        "comentario_forum",
      ]);
    }
  }

  if (confirmar && novas.length > 0) {
    for (let i = 0; i < novas.length; i += 500) {
      await appendRows("principal", NOTIF_SHEET, novas.slice(i, i + 500));
    }
  }

  return json({
    success: true,
    modo: confirmar ? "gravado" : "simulação (use &confirmar=1 pra gravar)",
    desde: desdeStr,
    comentariosAnalisados: analisados,
    jaExistiam,
    criadas: confirmar ? novas.length : 0,
    seriamCriadas: novas.length,
    semDonoCadastrado: semDono,
    topicosSemArtista: semArtista,
    amostra: novas.slice(0, 25).map((r) => `${r[8]} — ${r[3]} comentou ${r[5]} (dono ${r[1]})`),
  });
}

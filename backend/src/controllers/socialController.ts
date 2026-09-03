import { googleSheetsService, normalizeText, normalizeComparison } from "../services/googleSheetsService";
import { somarPrestigio } from "../services/prestigioService";
import { ADMIN_TG_ID, requestProvesAdmin } from "../services/sessionService";
import { deleteFileFromDrive } from "../services/googleDriveService";

// Dados sociais (posts, perfis, comentários e news) vivem na planilha
// "usuarios" (a mesma de Usuários/ARTISTAS), em abas próprias: SOCIAL_POSTS,
// SOCIAL_PERFIS, SOCIAL_COMMENTS, SOCIAL_NEWS. Layout de colunas confirmado
// ao vivo (não normalizamos os headers aqui — a aba SOCIAL_POSTS tem
// cabeçalhos numerados tipo "1. ID", então indexamos por posição, que é
// robusto pros dois casos):
//
// SOCIAL_POSTS:   A id | B tipo | C subtipo | D autor | E texto | F media_url | G analytics(json) | H data | I telegram_id | J media_tipo ("imagem"/"video", coluna nova — linhas antigas ficam vazias e continuam tratadas como imagem)
// SOCIAL_PERFIS:  A artista | B rede | C handle | D bio | E avatar_url | F telegram_id | G seguidores | H seguindo
// SOCIAL_COMMENTS:A postid | B autor | C texto | D data | E telegram_id
// SOCIAL_NEWS:    A id | B titulo | C conteudo | D imagem | E autor | F data | G telegram_id | H origem_tipo ("tour" quando a notícia veio de uma ação de turnê, vazio quando é matéria normal) | I origem_id (id_unico da turnê) | J origem_show (número do show)

const SHEETS = {
  posts: "SOCIAL_POSTS",
  perfis: "SOCIAL_PERFIS",
  comments: "SOCIAL_COMMENTS",
  news: "SOCIAL_NEWS",
} as const;

function genId(prefix: string): string {
  const rand = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  return `${prefix}-${rand}`;
}

interface AnalyticsJson {
  likes: number;
  comments: number;
  shares: number;
  likedBy?: string[];
}

function parseAnalytics(raw: string): AnalyticsJson {
  try {
    const parsed = JSON.parse(raw || "{}");
    return {
      likes: Number(parsed.likes) || 0,
      comments: Number(parsed.comments) || 0,
      shares: Number(parsed.shares) || 0,
      likedBy: Array.isArray(parsed.likedBy) ? parsed.likedBy.map((x: unknown) => String(x)) : undefined,
    };
  } catch {
    return { likes: 0, comments: 0, shares: 0 };
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function readRows(sheet: string): Promise<string[][]> {
  const rows = await googleSheetsService.usuarios.readValues(sheet);
  return rows.slice(1).filter((row) => row.some((cell) => normalizeText(cell)));
}

// -------------------- POSTS --------------------

export async function getSocialPostsController(): Promise<Response> {
  let postsRows: string[][];
  let perfisRows: string[][];
  try {
    [postsRows, perfisRows] = await Promise.all([readRows(SHEETS.posts), readRows(SHEETS.perfis)]);
  } catch (err) {
    // Sem isso, uma falha de leitura (ex: pico de chamadas na API do Sheets)
    // vazava como exceção não tratada até o topo do Worker, e o frontend via
    // isso como "sem posts" em vez de um erro real pra tentar de novo.
    console.error("[getSocialPostsController] Erro:", err);
    return jsonResponse({ error: "Falha ao carregar publicações." }, 500);
  }

  const posts = postsRows
    .map((row) => {
      const id = normalizeText(row[0]);
      const tipo = normalizeText(row[1]);
      const autor = normalizeText(row[3]);
      const perfil = perfisRows.find(
        (p) =>
          normalizeComparison(p[0]) === normalizeComparison(autor) && normalizeComparison(p[1]) === normalizeComparison(tipo),
      );
      return {
        id,
        tipo,
        subtipo: normalizeText(row[2]) || undefined,
        autor,
        handle: perfil ? normalizeText(perfil[2]) : undefined,
        avatar: perfil ? normalizeText(perfil[4]) : undefined,
        texto: normalizeText(row[4]),
        media_url: normalizeText(row[5]) || undefined,
        analytics: parseAnalytics(row[6]),
        data: normalizeText(row[7]),
        telegram_id: normalizeText(row[8]) || undefined,
        media_tipo: normalizeText(row[9]) || undefined,
      };
    })
    .filter((p) => p.id);

  posts.sort((a, b) => new Date(b.data).getTime() - new Date(a.data).getTime());

  return jsonResponse(posts);
}

export async function createSocialPostController(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as {
    payload?: string;
    tgId?: string;
  };
  const payload = JSON.parse(body.payload || "{}") as {
    tipo?: string;
    subtipo?: string;
    autor?: string;
    texto?: string;
    media_url?: string;
    media_tipo?: string;
    analytics?: AnalyticsJson;
  };

  if (!payload.tipo || !payload.autor || !payload.texto?.trim()) {
    return jsonResponse({ ok: false, error: "Dados incompletos para o post." }, 400);
  }

  const id = genId("POST");
  const analytics = payload.analytics || { likes: 0, comments: 0, shares: 0 };

  await googleSheetsService.usuarios.appendRow(SHEETS.posts, [
    id,
    payload.tipo,
    payload.subtipo || "",
    payload.autor,
    payload.texto,
    payload.media_url || "",
    JSON.stringify(analytics),
    new Date().toISOString(),
    body.tgId || "",
    payload.media_url ? payload.media_tipo || "imagem" : "",
  ]);

  await somarPrestigio({ telegramId: body.tgId, usuario: payload.autor }, "post_social").catch(() => {});

  return jsonResponse({ ok: true, id });
}

export async function curtirSocialPostController(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as { postId?: string; tgId?: string };
  if (!body.postId) return jsonResponse({ ok: false, error: "postId obrigatório." }, 400);

  const rows = await googleSheetsService.usuarios.readValues(SHEETS.posts);
  const rowIndex = rows.findIndex((row, i) => i > 0 && normalizeText(row[0]) === body.postId);
  if (rowIndex === -1) return jsonResponse({ ok: false, error: "Post não encontrado." }, 404);

  const analytics = parseAnalytics(rows[rowIndex][6]);
  const tgId = normalizeText(body.tgId || "");
  const likedBy = analytics.likedBy || [];
  // Sem nenhum controle de "quem já curtiu", o botão de curtir clicado
  // várias vezes somava curtida + prestígio sem limite nenhum — bastava
  // martelar o coração pra inflar prestígio de graça. Cada jogador só conta
  // 1x por post agora, guardado dentro do próprio JSON de analytics (sem
  // precisar de aba/coluna nova).
  const jaCurtiu = !!tgId && likedBy.includes(tgId);
  if (!jaCurtiu) {
    analytics.likes += 1;
    if (tgId) analytics.likedBy = [...likedBy, tgId];
  }

  await googleSheetsService.usuarios.updateValues(SHEETS.posts, `G${rowIndex + 1}`, [[JSON.stringify(analytics)]]);

  if (tgId && !jaCurtiu) {
    await somarPrestigio({ telegramId: tgId }, "curtida").catch(() => {});
  }

  return jsonResponse({ ok: true, likes: analytics.likes });
}

/**
 * POST /api/social/posts/editar
 * Só quem publicou o post (coluna I — telegram_id) pode editar texto e/ou
 * mídia depois de publicado.
 */
export async function editSocialPostController(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as {
    postId?: string;
    texto?: string;
    media_url?: string;
    media_tipo?: string;
    tgId?: string;
    autor?: string;
  };
  const { postId, texto, tgId } = body;
  const media_url = body.media_url ?? "";

  if (!postId || !texto?.trim() || !tgId) {
    return jsonResponse({ ok: false, error: "Dados incompletos para editar o post." }, 400);
  }

  const rows = await googleSheetsService.usuarios.readValues(SHEETS.posts);
  const rowIndex = rows.findIndex((row, i) => i > 0 && normalizeText(row[0]) === postId);
  if (rowIndex === -1) return jsonResponse({ ok: false, error: "Post não encontrado." }, 404);

  const ownerId = normalizeText(rows[rowIndex][8]);
  // Bypass de admin só vale se o token de sessão realmente prova que quem
  // está chamando autenticou como ADMIN_TG_ID — sem isso, qualquer cliente
  // que soubesse o ID hardcoded conseguia editar post de qualquer um.
  const claimsAdmin = tgId.trim() === ADMIN_TG_ID;
  const isAdmin = claimsAdmin && (await requestProvesAdmin(request));
  if (!ownerId || (ownerId !== tgId.trim() && !isAdmin)) {
    return jsonResponse({ ok: false, error: "Você só pode editar seus próprios posts." }, 403);
  }

  // autor (coluna D) é opcional — só quando o dono está trocando entre
  // Blackout Mode (nome fictício) e Normal Mode (nome real do artista) ou
  // ajustando o nome fictício depois de já ter publicado.
  const autorTrim = body.autor?.trim();
  if (autorTrim) {
    await googleSheetsService.usuarios.updateValues(SHEETS.posts, `D${rowIndex + 1}:F${rowIndex + 1}`, [
      [autorTrim, texto.trim(), media_url],
    ]);
  } else {
    await googleSheetsService.usuarios.updateValues(SHEETS.posts, `E${rowIndex + 1}:F${rowIndex + 1}`, [
      [texto.trim(), media_url],
    ]);
  }

  // media_tipo (coluna J) — só reescreve quando o dono trocou a mídia (uma
  // coluna solta, fora do range contíguo D:F acima, por isso um update
  // separado em vez de tentar encaixar no mesmo range).
  await googleSheetsService.usuarios.updateValues(SHEETS.posts, `J${rowIndex + 1}`, [
    [media_url ? body.media_tipo || "imagem" : ""],
  ]);

  return jsonResponse({ ok: true });
}

const PRAZO_EXCLUSAO_MS = 24 * 60 * 60 * 1000;

/**
 * POST /api/social/deletar
 * Apaga um post (limpa a linha inteira, mesma lógica de "linha vazia =
 * ignorada" que já existe em readRows). Só o dono do post pode apagar, e só
 * até 24h depois de publicado — depois disso, fica registrado pra sempre
 * (mesma regra usada em outras redes sociais reais). Admin (810141686)
 * ignora as duas checagens, igual editSocialPostController já fazia.
 */
export async function deleteSocialPostController(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as { postId?: string; tgId?: string };
  const { postId, tgId } = body;

  if (!postId || !tgId) {
    return jsonResponse({ ok: false, error: "Dados incompletos para excluir o post." }, 400);
  }

  const rows = await googleSheetsService.usuarios.readValues(SHEETS.posts);
  const rowIndex = rows.findIndex((row, i) => i > 0 && normalizeText(row[0]) === postId);
  if (rowIndex === -1) return jsonResponse({ ok: false, error: "Post não encontrado." }, 404);

  const isAdmin = tgId.trim() === ADMIN_TG_ID && (await requestProvesAdmin(request));
  const ownerId = normalizeText(rows[rowIndex][8]);
  if (!isAdmin && (!ownerId || ownerId !== tgId.trim())) {
    return jsonResponse({ ok: false, error: "Você só pode excluir seus próprios posts." }, 403);
  }

  if (!isAdmin) {
    const dataPost = new Date(normalizeText(rows[rowIndex][7])).getTime();
    if (Number.isFinite(dataPost) && Date.now() - dataPost > PRAZO_EXCLUSAO_MS) {
      return jsonResponse(
        { ok: false, error: "O prazo de 24h pra excluir esse post já passou." },
        403,
      );
    }
  }

  await googleSheetsService.usuarios.updateValues(SHEETS.posts, `A${rowIndex + 1}:J${rowIndex + 1}`, [
    ["", "", "", "", "", "", "", "", "", ""],
  ]);

  return jsonResponse({ ok: true });
}

const STORY_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Roda pelo cron (ver server.ts "scheduled") a cada execução — varre
 * SOCIAL_POSTS por Stories (tipo Instagram, subtipo Story) publicados há
 * mais de 24h e apaga de verdade: limpa a linha na planilha (mesmo padrão de
 * soft-delete usado no resto do arquivo) e apaga o arquivo de mídia
 * correspondente do Google Drive. Diferente do delete manual do dono
 * (deleteSocialPostController), aqui não tem "dono" clicando — é limpeza
 * automática, então roda sem checagem de tgId.
 */
export async function limparStoriesExpiradosScheduled(): Promise<{ apagados: number }> {
  const rows = await googleSheetsService.usuarios.readValues(SHEETS.posts);
  const agora = Date.now();

  const expirados = rows
    .map((row, i) => ({ row, rowIndex: i + 1 }))
    .filter(({ row, rowIndex }) => {
      if (rowIndex <= 1) return false;
      const tipo = normalizeText(row[1]);
      const subtipo = normalizeText(row[2]);
      const id = normalizeText(row[0]);
      if (!id || tipo !== "Instagram" || subtipo !== "Story") return false;
      const dataPost = new Date(normalizeText(row[7])).getTime();
      return Number.isFinite(dataPost) && agora - dataPost > STORY_TTL_MS;
    });

  for (const { row, rowIndex } of expirados) {
    const mediaUrl = normalizeText(row[5]);
    if (mediaUrl) {
      await deleteFileFromDrive(mediaUrl).catch((err) =>
        console.warn(`[limparStoriesExpiradosScheduled] Falha ao apagar mídia do Drive (linha ${rowIndex}):`, err),
      );
    }
    await googleSheetsService.usuarios.updateValues(SHEETS.posts, `A${rowIndex}:J${rowIndex}`, [
      ["", "", "", "", "", "", "", "", "", ""],
    ]);
  }

  return { apagados: expirados.length };
}

// -------------------- COMENTÁRIOS --------------------

export async function getSocialComentariosController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const postId = url.searchParams.get("postId") || "";

  const allRows = await googleSheetsService.usuarios.readValues(SHEETS.comments);
  const comments = allRows
    .map((row, i) => ({ row, rowIndex: i + 1 }))
    .filter(({ row, rowIndex }) => rowIndex > 1 && normalizeText(row[0]) === postId)
    .map(({ row, rowIndex }) => ({
      autor: normalizeText(row[1]),
      texto: normalizeText(row[2]),
      data: normalizeText(row[3]),
      telegram_id: normalizeText(row[4]) || undefined,
      rowIndex,
    }));

  return jsonResponse(comments);
}

/**
 * POST /api/social/comentario/editar
 * Só quem escreveu o comentário (coluna E — telegram_id) pode editá-lo.
 */
export async function editSocialCommentController(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as {
    rowIndex?: number;
    texto?: string;
    tgId?: string;
  };
  const { rowIndex, texto, tgId } = body;

  if (!rowIndex || rowIndex < 2 || !texto?.trim() || !tgId) {
    return jsonResponse({ ok: false, error: "Parâmetros inválidos pra editar este comentário." }, 400);
  }

  const ownerRows = await googleSheetsService.usuarios.readValues(SHEETS.comments, `E${rowIndex}:E${rowIndex}`);
  const ownerId = normalizeText(ownerRows?.[0]?.[0]);
  const claimsAdmin = tgId.trim() === ADMIN_TG_ID;
  const isAdmin = claimsAdmin && (await requestProvesAdmin(request));
  if (!ownerId || (ownerId !== tgId.trim() && !isAdmin)) {
    return jsonResponse({ ok: false, error: "Você só pode editar seus próprios comentários." }, 403);
  }

  await googleSheetsService.usuarios.updateValues(SHEETS.comments, `C${rowIndex}`, [[texto.trim()]]);

  return jsonResponse({ ok: true });
}

export async function comentarSocialPostController(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as { payload?: string; tgId?: string };
  const payload = JSON.parse(body.payload || "{}") as { postId?: string; autor?: string; texto?: string };

  if (!payload.postId || !payload.autor || !payload.texto?.trim()) {
    return jsonResponse({ ok: false, error: "Dados incompletos para o comentário." }, 400);
  }

  await googleSheetsService.usuarios.appendRow(SHEETS.comments, [
    payload.postId,
    payload.autor,
    payload.texto,
    new Date().toISOString(),
    body.tgId || "",
  ]);

  const rows = await googleSheetsService.usuarios.readValues(SHEETS.posts);
  const rowIndex = rows.findIndex((row, i) => i > 0 && normalizeText(row[0]) === payload.postId);
  if (rowIndex !== -1) {
    const analytics = parseAnalytics(rows[rowIndex][6]);
    analytics.comments += 1;
    await googleSheetsService.usuarios.updateValues(SHEETS.posts, `G${rowIndex + 1}`, [[JSON.stringify(analytics)]]);
  }

  await somarPrestigio({ telegramId: body.tgId, usuario: payload.autor }, "comentario").catch(() => {});

  return jsonResponse({ ok: true });
}

// -------------------- PERFIS --------------------

export async function getSocialPerfisController(): Promise<Response> {
  const rows = await readRows(SHEETS.perfis);
  const perfis = rows.map((row) => {
    const avatarUrl = normalizeText(row[4]);
    return {
      artista: normalizeText(row[0]),
      rede: normalizeText(row[1]),
      handle: normalizeText(row[2]),
      bio: normalizeText(row[3]),
      avatar_url: avatarUrl,
      avatar: avatarUrl,
      foto: avatarUrl,
      seguidores: Number(normalizeText(row[6])) || 0,
      seguindo: Number(normalizeText(row[7])) || 0,
    };
  });
  return jsonResponse(perfis);
}

export async function saveSocialPerfilController(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as { payload?: string; tgId?: string };
  const payload = JSON.parse(body.payload || "{}") as {
    artista?: string;
    rede?: string;
    handle?: string;
    avatar_url?: string;
    avatar?: string;
    foto?: string;
    bio?: string;
    seguindo?: number;
  };

  if (!payload.artista || !payload.rede) {
    return jsonResponse({ ok: false, error: "Artista e rede são obrigatórios." }, 400);
  }

  const avatarUrl = payload.avatar_url || payload.avatar || payload.foto || "";
  const handle = payload.handle || "@";
  const bio = payload.bio || "";
  const seguindo = Number(payload.seguindo) || 0;

  const rows = await googleSheetsService.usuarios.readValues(SHEETS.perfis);
  const rowIndex = rows.findIndex(
    (row, i) =>
      i > 0 &&
      normalizeComparison(row[0]) === normalizeComparison(payload.artista!) &&
      normalizeComparison(row[1]) === normalizeComparison(payload.rede!),
  );

  if (rowIndex !== -1) {
    await googleSheetsService.usuarios.updateValues(SHEETS.perfis, `C${rowIndex + 1}:E${rowIndex + 1}`, [
      [handle, bio, avatarUrl],
    ]);
    await googleSheetsService.usuarios.updateValues(SHEETS.perfis, `H${rowIndex + 1}`, [[String(seguindo)]]);
  } else {
    await googleSheetsService.usuarios.appendRow(SHEETS.perfis, [
      payload.artista,
      payload.rede,
      handle,
      bio,
      avatarUrl,
      body.tgId || "",
      "0",
      String(seguindo),
    ]);
  }

  return jsonResponse({ ok: true });
}

// -------------------- NEWS --------------------

export async function getSocialNewsController(): Promise<Response> {
  const rows = await readRows(SHEETS.news);
  const news = rows
    .map((row) => ({
      id: normalizeText(row[0]),
      titulo: normalizeText(row[1]),
      conteudo: normalizeText(row[2]),
      imagem: normalizeText(row[3]),
      autor: normalizeText(row[4]),
      data: normalizeText(row[5]),
      telegramId: normalizeText(row[6]),
      origemTipo: normalizeText(row[7]) || undefined,
      origemId: normalizeText(row[8]) || undefined,
      origemShow: normalizeText(row[9]) || undefined,
    }))
    .filter((n) => n.id);

  news.sort((a, b) => new Date(b.data).getTime() - new Date(a.data).getTime());

  return jsonResponse(news);
}

export async function saveSocialNewsController(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as { payload?: string; tgId?: string };
  const payload = JSON.parse(body.payload || "{}") as {
    titulo?: string;
    conteudo?: string;
    imagem?: string;
    autor?: string;
  };

  if (!payload.titulo?.trim() || !payload.conteudo?.trim() || !payload.autor) {
    return jsonResponse({ ok: false, error: "Dados incompletos para a matéria." }, 400);
  }

  const id = await publicarNewsSocial({
    titulo: payload.titulo,
    conteudo: payload.conteudo,
    imagem: payload.imagem || "",
    autor: payload.autor,
    telegramId: body.tgId || "",
  });

  return jsonResponse({ ok: true, id });
}

/**
 * Publica uma notícia em SOCIAL_NEWS — usada tanto pelo formulário normal de
 * matéria (saveSocialNewsController) quanto por outros módulos que precisam
 * jogar um evento pra lá automaticamente (ex: ações de turnê, ver
 * tourController.ts). Quando `origemTipo`/`origemId` vêm preenchidos, o
 * frontend sabe que "comentar" nessa notícia deve levar pra tela original
 * (ex: comentários da turnê), em vez do comentário genérico de News.
 */
export async function publicarNewsSocial(params: {
  titulo: string;
  conteudo: string;
  imagem?: string;
  autor: string;
  telegramId?: string;
  origemTipo?: string;
  origemId?: string;
  origemShow?: string | number;
}): Promise<string> {
  const id = genId("NEWS");
  await googleSheetsService.usuarios.appendRow(
    SHEETS.news,
    [
      id,
      params.titulo,
      params.conteudo,
      params.imagem || "",
      params.autor,
      new Date().toISOString(),
      params.telegramId || "",
      params.origemTipo || "",
      params.origemId || "",
      params.origemShow != null ? String(params.origemShow) : "",
    ],
    "A:J",
  );
  return id;
}

/**
 * POST /api/social/news/editar
 * Só quem criou a news (coluna G — telegram_id) pode editá-la, pra corrigir
 * erro de texto/imagem depois de publicada.
 */
export async function editSocialNewsController(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as {
    id?: string;
    titulo?: string;
    conteudo?: string;
    imagem?: string;
    tgId?: string;
  };
  const { id, titulo, conteudo, imagem, tgId } = body;

  if (!id || !titulo?.trim() || !conteudo?.trim() || !tgId) {
    return jsonResponse({ ok: false, error: "Parâmetros inválidos pra editar esta matéria." }, 400);
  }

  const rows = await googleSheetsService.usuarios.readValues(SHEETS.news);
  const rowIndex = rows.findIndex((row, i) => i > 0 && normalizeText(row[0]) === id.trim());
  if (rowIndex === -1) {
    return jsonResponse({ ok: false, error: "Matéria não encontrada." }, 404);
  }

  const isAdmin = tgId.trim() === ADMIN_TG_ID && (await requestProvesAdmin(request));
  const ownerId = normalizeText(rows[rowIndex][6]);
  if (!isAdmin && (!ownerId || ownerId !== tgId.trim())) {
    return jsonResponse({ ok: false, error: "Você só pode editar suas próprias matérias." }, 403);
  }

  const sheetRow = rowIndex + 1;
  await googleSheetsService.usuarios.updateValues(SHEETS.news, `B${sheetRow}:D${sheetRow}`, [
    [titulo.trim(), conteudo.trim(), imagem?.trim() || ""],
  ]);

  return jsonResponse({ ok: true });
}

/**
 * POST /api/social/news/deletar
 * Só quem criou a news (coluna G — telegram_id) pode excluí-la. Segue o
 * mesmo padrão de "soft delete" de deleteSocialPostController: limpa a
 * linha inteira em vez de removê-la (evita reindexar linhas), e as leituras
 * já ignoram linha com id vazio.
 */
export async function deleteSocialNewsController(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as { id?: string; tgId?: string };
  const { id, tgId } = body;

  if (!id || !tgId) {
    return jsonResponse({ ok: false, error: "Dados incompletos pra excluir esta matéria." }, 400);
  }

  const rows = await googleSheetsService.usuarios.readValues(SHEETS.news);
  const rowIndex = rows.findIndex((row, i) => i > 0 && normalizeText(row[0]) === id.trim());
  if (rowIndex === -1) {
    return jsonResponse({ ok: false, error: "Matéria não encontrada." }, 404);
  }

  const isAdmin = tgId.trim() === ADMIN_TG_ID && (await requestProvesAdmin(request));
  const ownerId = normalizeText(rows[rowIndex][6]);
  if (!isAdmin && (!ownerId || ownerId !== tgId.trim())) {
    return jsonResponse({ ok: false, error: "Você só pode excluir suas próprias matérias." }, 403);
  }

  await googleSheetsService.usuarios.updateValues(SHEETS.news, `A${rowIndex + 1}:J${rowIndex + 1}`, [
    ["", "", "", "", "", "", "", "", "", ""],
  ]);

  return jsonResponse({ ok: true });
}

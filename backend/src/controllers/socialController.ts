import { googleSheetsService, normalizeText, normalizeComparison } from "../services/googleSheetsService";

// Dados sociais (posts, perfis, comentários e news) vivem na planilha
// "usuarios" (a mesma de Usuários/ARTISTAS), em abas próprias: SOCIAL_POSTS,
// SOCIAL_PERFIS, SOCIAL_COMMENTS, SOCIAL_NEWS. Layout de colunas confirmado
// ao vivo (não normalizamos os headers aqui — a aba SOCIAL_POSTS tem
// cabeçalhos numerados tipo "1. ID", então indexamos por posição, que é
// robusto pros dois casos):
//
// SOCIAL_POSTS:   A id | B tipo | C subtipo | D autor | E texto | F media_url | G analytics(json) | H data | I telegram_id
// SOCIAL_PERFIS:  A artista | B rede | C handle | D bio | E avatar_url | F telegram_id | G seguidores | H seguindo
// SOCIAL_COMMENTS:A postid | B autor | C texto | D data | E telegram_id
// SOCIAL_NEWS:    A id | B titulo | C conteudo | D imagem | E autor | F data | G telegram_id

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
}

function parseAnalytics(raw: string): AnalyticsJson {
  try {
    const parsed = JSON.parse(raw || "{}");
    return {
      likes: Number(parsed.likes) || 0,
      comments: Number(parsed.comments) || 0,
      shares: Number(parsed.shares) || 0,
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
  const [postsRows, perfisRows] = await Promise.all([readRows(SHEETS.posts), readRows(SHEETS.perfis)]);

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
  ]);

  return jsonResponse({ ok: true, id });
}

export async function curtirSocialPostController(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as { postId?: string };
  if (!body.postId) return jsonResponse({ ok: false, error: "postId obrigatório." }, 400);

  const rows = await googleSheetsService.usuarios.readValues(SHEETS.posts);
  const rowIndex = rows.findIndex((row, i) => i > 0 && normalizeText(row[0]) === body.postId);
  if (rowIndex === -1) return jsonResponse({ ok: false, error: "Post não encontrado." }, 404);

  const analytics = parseAnalytics(rows[rowIndex][6]);
  analytics.likes += 1;

  await googleSheetsService.usuarios.updateValues(SHEETS.posts, `G${rowIndex + 1}`, [[JSON.stringify(analytics)]]);

  return jsonResponse({ ok: true, likes: analytics.likes });
}

// -------------------- COMENTÁRIOS --------------------

export async function getSocialComentariosController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const postId = url.searchParams.get("postId") || "";

  const rows = await readRows(SHEETS.comments);
  const comments = rows
    .filter((row) => normalizeText(row[0]) === postId)
    .map((row) => ({
      autor: normalizeText(row[1]),
      texto: normalizeText(row[2]),
      data: normalizeText(row[3]),
    }));

  return jsonResponse(comments);
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

  const id = genId("NEWS");
  await googleSheetsService.usuarios.appendRow(SHEETS.news, [
    id,
    payload.titulo,
    payload.conteudo,
    payload.imagem || "",
    payload.autor,
    new Date().toISOString(),
    body.tgId || "",
  ]);

  return jsonResponse({ ok: true, id });
}

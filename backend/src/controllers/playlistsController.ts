import { googleSheetsService, normalizeText } from "../services/googleSheetsService";

// Playlists vivem na planilha "usuarios" (a mesma de Usuários/Social), na
// aba "Playlists" — layout confirmado ao vivo:
//
// Playlists: A id | B titulo | C descricao | D capa_url | E owner | F telegram_id | G tracks_json | H data
//
// Atenção: o cabeçalho da linha 1 da planilha tem "data" e "tracks_json"
// escritos na ordem trocada (G diz "data", H diz "tracks_json"), mas os
// dados reais em toda a aba estão na ordem acima (JSON na G, data na H) —
// por isso indexamos por posição real, não pelo texto do cabeçalho.
//
// As faixas ficam embutidas na própria linha como um array JSON (tracks_json),
// não em aba separada.
//
// "Playlists_Albuns" e "Playlists_Faixas" são o catálogo usado pra montar
// playlists (não playlists em si) — o picker de faixas do editor lê daqui:
//
// Playlists_Albuns:  A id | B artista | C titulo | D genero | E data | F descricao | G capa_url | H contracapa_url | I encarte_json | J telegram_id | K created_at
// Playlists_Faixas:  A album_id | B numero | C titulo | D artistas | E duracao | F drive_url | G letra
//
// Substitui a dependência antiga do Apps Script (acao=listar_playlists/
// salvar_playlist/get_playlist/excluir_playlist/listar_faixas_catalogo).
//
// "Salvos" (faixas curtidas por jogador, tipo "Músicas Curtidas" do
// Spotify) vive na mesma planilha, aba própria:
//
// Salvos: A telegram_id | B album_id | C faixa_numero | D titulo | E artistas | F drive_url | G capa_url | H data

const SHEET = "Playlists";
const SHEET_ALBUNS = "Playlists_Albuns";
const SHEET_FAIXAS = "Playlists_Faixas";
const SHEET_SALVOS = "Salvos";

function genId(): string {
  return `PL-${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function readRows(): Promise<string[][]> {
  const rows = await googleSheetsService.usuarios.readValues(SHEET);
  return rows.slice(1).filter((row) => row.some((cell) => normalizeText(cell)));
}

interface PlaylistTrackRow {
  album_id: string;
  faixa_numero: number;
  titulo: string;
  artistas: string;
  drive_url: string;
  capa_url?: string;
}

interface PlaylistRecord {
  id: string;
  titulo: string;
  descricao?: string;
  capa_url?: string;
  owner: string;
  telegram_id?: string;
  data?: string;
  tracks: PlaylistTrackRow[];
}

function parseTracks(raw: string): PlaylistTrackRow[] {
  try {
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function rowToPlaylist(row: string[]): PlaylistRecord {
  return {
    id: normalizeText(row[0]),
    titulo: normalizeText(row[1]),
    descricao: normalizeText(row[2]) || undefined,
    capa_url: normalizeText(row[3]) || undefined,
    owner: normalizeText(row[4]),
    telegram_id: normalizeText(row[5]) || undefined,
    tracks: parseTracks(row[6]),
    data: normalizeText(row[7]) || undefined,
  };
}

// -------------------- LISTAGEM / DETALHE --------------------

export async function getPlaylistsController(): Promise<Response> {
  const rows = await readRows();
  const playlists = rows.map(rowToPlaylist).filter((p) => p.id && p.titulo);

  playlists.sort((a, b) => new Date(b.data || 0).getTime() - new Date(a.data || 0).getTime());

  return jsonResponse(playlists);
}

export async function getPlaylistByIdController(id: string): Promise<Response> {
  const rows = await readRows();
  const row = rows.find((r) => normalizeText(r[0]) === id);
  if (!row) return jsonResponse({ error: "Playlist não encontrada." }, 404);

  return jsonResponse(rowToPlaylist(row));
}

// -------------------- CRIAR / EDITAR --------------------

export async function savePlaylistController(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as { payload?: string; tgId?: string };
  const payload = JSON.parse(body.payload || "{}") as {
    id?: string;
    titulo?: string;
    descricao?: string;
    capa_url?: string;
    owner?: string;
    tracks?: PlaylistTrackRow[];
    data?: string;
  };

  if (!payload.titulo?.trim() || !payload.tracks?.length) {
    return jsonResponse({ ok: false, error: "Título e ao menos uma faixa são obrigatórios." }, 400);
  }

  const tgId = body.tgId || "";
  const allRows = await googleSheetsService.usuarios.readValues(SHEET);
  const isEdit = Boolean(payload.id);
  const rowIndex = isEdit ? allRows.findIndex((row, i) => i > 0 && normalizeText(row[0]) === payload.id) : -1;

  if (isEdit && rowIndex === -1) {
    return jsonResponse({ ok: false, error: "Playlist não encontrada." }, 404);
  }
  if (isEdit) {
    const ownerTgId = normalizeText(allRows[rowIndex][5]);
    if (ownerTgId && tgId && ownerTgId !== tgId && tgId !== "810141686") {
      return jsonResponse({ ok: false, error: "Sem permissão para editar essa playlist." }, 403);
    }
  }

  const id = payload.id || genId();
  const data = payload.data || new Date().toISOString().slice(0, 10);
  const tracksJson = JSON.stringify(payload.tracks);

  if (isEdit) {
    await googleSheetsService.usuarios.updateValues(SHEET, `B${rowIndex + 1}:H${rowIndex + 1}`, [
      [payload.titulo, payload.descricao || "", payload.capa_url || "", payload.owner || "", tgId, tracksJson, data],
    ]);
  } else {
    await googleSheetsService.usuarios.appendRow(SHEET, [
      id,
      payload.titulo,
      payload.descricao || "",
      payload.capa_url || "",
      payload.owner || "",
      tgId,
      tracksJson,
      data,
    ]);
  }

  return jsonResponse({ ok: true, id });
}

// -------------------- CATÁLOGO (pra montar playlists) --------------------

export async function getPlaylistsCatalogoController(): Promise<Response> {
  const [albunsRows, faixasRows] = await Promise.all([
    (async () => {
      const rows = await googleSheetsService.usuarios.readValues(SHEET_ALBUNS);
      return rows.slice(1).filter((row) => row.some((cell) => normalizeText(cell)));
    })(),
    (async () => {
      const rows = await googleSheetsService.usuarios.readValues(SHEET_FAIXAS);
      return rows.slice(1).filter((row) => row.some((cell) => normalizeText(cell)));
    })(),
  ]);

  const albunsById = new Map(
    albunsRows.map((row) => [
      normalizeText(row[0]),
      { artista: normalizeText(row[1]), titulo: normalizeText(row[2]), capa_url: normalizeText(row[6]) },
    ]),
  );

  const faixas = faixasRows
    .map((row) => {
      const album_id = normalizeText(row[0]);
      const album = albunsById.get(album_id);
      return {
        album_id,
        numero: Number(row[1]) || 0,
        titulo: normalizeText(row[2]),
        artistas: normalizeText(row[3]) || album?.artista || "",
        duracao: normalizeText(row[4]) || undefined,
        drive_url: normalizeText(row[5]),
        capa_url: album?.capa_url || undefined,
      };
    })
    .filter((f) => f.titulo && f.drive_url);

  return jsonResponse(faixas);
}

// -------------------- SALVOS (faixas curtidas) --------------------

export async function getSalvosController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const tgId = url.searchParams.get("tgId") || "";
  if (!tgId) return jsonResponse([]);

  const rows = await googleSheetsService.usuarios.readValues(SHEET_SALVOS);
  const salvos = rows
    .slice(1)
    .filter((row) => row.some((cell) => normalizeText(cell)) && normalizeText(row[0]) === tgId)
    .map((row) => ({
      album_id: normalizeText(row[1]),
      faixa_numero: Number(row[2]) || 0,
      titulo: normalizeText(row[3]),
      artistas: normalizeText(row[4]),
      drive_url: normalizeText(row[5]),
      capa_url: normalizeText(row[6]) || undefined,
      data: normalizeText(row[7]) || undefined,
    }))
    .filter((t) => t.titulo && t.drive_url);

  salvos.sort((a, b) => new Date(b.data || 0).getTime() - new Date(a.data || 0).getTime());

  return jsonResponse(salvos);
}

export async function saveSalvoController(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as {
    tgId?: string;
    track?: PlaylistTrackRow;
  };
  const { tgId, track } = body;
  if (!tgId || !track?.titulo || !track?.drive_url) {
    return jsonResponse({ ok: false, error: "Dados incompletos pra salvar a faixa." }, 400);
  }

  const rows = await googleSheetsService.usuarios.readValues(SHEET_SALVOS);
  const alreadySaved = rows
    .slice(1)
    .some((row) => normalizeText(row[0]) === tgId && normalizeText(row[5]) === track.drive_url);
  if (alreadySaved) return jsonResponse({ ok: true, already: true });

  await googleSheetsService.usuarios.appendRow(SHEET_SALVOS, [
    tgId,
    track.album_id || "",
    String(track.faixa_numero || ""),
    track.titulo,
    track.artistas || "",
    track.drive_url,
    track.capa_url || "",
    new Date().toISOString(),
  ]);

  return jsonResponse({ ok: true });
}

export async function removeSalvoController(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as { tgId?: string; drive_url?: string };
  const { tgId, drive_url } = body;
  if (!tgId || !drive_url) {
    return jsonResponse({ ok: false, error: "Dados incompletos pra remover a faixa." }, 400);
  }

  const allRows = await googleSheetsService.usuarios.readValues(SHEET_SALVOS);
  const rowIndex = allRows.findIndex(
    (row, i) => i > 0 && normalizeText(row[0]) === tgId && normalizeText(row[5]) === drive_url,
  );
  if (rowIndex === -1) return jsonResponse({ ok: false, error: "Faixa não encontrada nos salvos." }, 404);

  await googleSheetsService.usuarios.updateValues(SHEET_SALVOS, `A${rowIndex + 1}`, [[""]]);

  return jsonResponse({ ok: true });
}

// -------------------- EXCLUIR --------------------

export async function deletePlaylistController(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as { id?: string; tgId?: string };
  if (!body.id) return jsonResponse({ ok: false, error: "id obrigatório." }, 400);

  const allRows = await googleSheetsService.usuarios.readValues(SHEET);
  const rowIndex = allRows.findIndex((row, i) => i > 0 && normalizeText(row[0]) === body.id);
  if (rowIndex === -1) return jsonResponse({ ok: false, error: "Playlist não encontrada." }, 404);

  const ownerTgId = normalizeText(allRows[rowIndex][5]);
  if (ownerTgId && body.tgId && ownerTgId !== body.tgId && body.tgId !== "810141686") {
    return jsonResponse({ ok: false, error: "Sem permissão para excluir essa playlist." }, 403);
  }

  await googleSheetsService.usuarios.updateValues(SHEET, `A${rowIndex + 1}`, [[""]]);

  return jsonResponse({ ok: true });
}

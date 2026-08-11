import { googleSheetsService, normalizeText } from "../services/googleSheetsService";

// Playlists vivem na planilha "usuarios" (a mesma de Usuários/Social), na
// aba "Playlists" — layout confirmado ao vivo:
//
// Playlists: A id | B titulo | C descricao | D capa_url | E owner | F telegram_id | G data | H tracks_json
//
// As faixas ficam embutidas na própria linha como um array JSON (tracks_json),
// não em aba separada. "Playlists_Faixas" e "Playlists_Albuns" — apesar do
// nome — são o catálogo de álbuns/faixas do jogo, não dados de playlist;
// não devem ser lidas nem escritas por este controller.
//
// Substitui a dependência antiga do Apps Script (acao=listar_playlists/
// salvar_playlist/...).

const SHEET = "Playlists";

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
    data: normalizeText(row[6]) || undefined,
    tracks: parseTracks(row[7]),
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
      [payload.titulo, payload.descricao || "", payload.capa_url || "", payload.owner || "", tgId, data, tracksJson],
    ]);
  } else {
    await googleSheetsService.usuarios.appendRow(SHEET, [
      id,
      payload.titulo,
      payload.descricao || "",
      payload.capa_url || "",
      payload.owner || "",
      tgId,
      data,
      tracksJson,
    ]);
  }

  return jsonResponse({ ok: true, id });
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

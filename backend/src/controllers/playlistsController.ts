import { googleSheetsService, normalizeText } from "../services/googleSheetsService";

// Playlists vivem na planilha "usuarios" (a mesma de Usuários/Social),
// em duas abas próprias: Playlists (metadados) e Playlists_Faixas (faixas,
// uma linha por faixa, ligadas por playlist_id). Substitui a dependência
// antiga do Apps Script (acao=listar_playlists/salvar_playlist/...).
//
// Playlists:        A id | B titulo | C descricao | D capa_url | E owner | F telegram_id | G data
// Playlists_Faixas: A playlist_id | B ordem | C album_id | D faixa_numero | E titulo | F artistas | G drive_url | H capa_url
//
// Se as abas ainda não existirem na planilha, crie-as com esses cabeçalhos
// exatos na linha 1 antes de usar em produção.

const SHEETS = {
  playlists: "Playlists",
  faixas: "Playlists_Faixas",
} as const;

function genId(): string {
  return `PL-${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;
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

function tracksForPlaylist(faixasRows: string[][], playlistId: string): PlaylistTrackRow[] {
  return faixasRows
    .filter((row) => normalizeText(row[0]) === playlistId)
    .sort((a, b) => (Number(a[1]) || 0) - (Number(b[1]) || 0))
    .map((row) => ({
      album_id: normalizeText(row[2]),
      faixa_numero: Number(row[3]) || 0,
      titulo: normalizeText(row[4]),
      artistas: normalizeText(row[5]),
      drive_url: normalizeText(row[6]),
      capa_url: normalizeText(row[7]) || undefined,
    }));
}

// -------------------- LISTAGEM / DETALHE --------------------

export async function getPlaylistsController(): Promise<Response> {
  const [playlistRows, faixasRows] = await Promise.all([readRows(SHEETS.playlists), readRows(SHEETS.faixas)]);

  const playlists: PlaylistRecord[] = playlistRows
    .map((row) => {
      const id = normalizeText(row[0]);
      return {
        id,
        titulo: normalizeText(row[1]),
        descricao: normalizeText(row[2]) || undefined,
        capa_url: normalizeText(row[3]) || undefined,
        owner: normalizeText(row[4]),
        telegram_id: normalizeText(row[5]) || undefined,
        data: normalizeText(row[6]) || undefined,
        tracks: tracksForPlaylist(faixasRows, id),
      };
    })
    .filter((p) => p.id && p.titulo);

  playlists.sort((a, b) => new Date(b.data || 0).getTime() - new Date(a.data || 0).getTime());

  return jsonResponse(playlists);
}

export async function getPlaylistByIdController(id: string): Promise<Response> {
  const [playlistRows, faixasRows] = await Promise.all([readRows(SHEETS.playlists), readRows(SHEETS.faixas)]);
  const row = playlistRows.find((r) => normalizeText(r[0]) === id);
  if (!row) return jsonResponse({ error: "Playlist não encontrada." }, 404);

  const playlist: PlaylistRecord = {
    id,
    titulo: normalizeText(row[1]),
    descricao: normalizeText(row[2]) || undefined,
    capa_url: normalizeText(row[3]) || undefined,
    owner: normalizeText(row[4]),
    telegram_id: normalizeText(row[5]) || undefined,
    data: normalizeText(row[6]) || undefined,
    tracks: tracksForPlaylist(faixasRows, id),
  };

  return jsonResponse(playlist);
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
  const playlistRows = await googleSheetsService.usuarios.readValues(SHEETS.playlists);
  const isEdit = Boolean(payload.id);
  const rowIndex = isEdit
    ? playlistRows.findIndex((row, i) => i > 0 && normalizeText(row[0]) === payload.id)
    : -1;

  if (isEdit && rowIndex === -1) {
    return jsonResponse({ ok: false, error: "Playlist não encontrada." }, 404);
  }
  if (isEdit) {
    const ownerTgId = normalizeText(playlistRows[rowIndex][5]);
    if (ownerTgId && tgId && ownerTgId !== tgId && tgId !== "810141686") {
      return jsonResponse({ ok: false, error: "Sem permissão para editar essa playlist." }, 403);
    }
  }

  const id = payload.id || genId();
  const data = payload.data || new Date().toISOString().slice(0, 10);

  if (isEdit) {
    await googleSheetsService.usuarios.updateValues(SHEETS.playlists, `B${rowIndex + 1}:E${rowIndex + 1}`, [
      [payload.titulo, payload.descricao || "", payload.capa_url || "", payload.owner || ""],
    ]);
  } else {
    await googleSheetsService.usuarios.appendRow(SHEETS.playlists, [
      id,
      payload.titulo,
      payload.descricao || "",
      payload.capa_url || "",
      payload.owner || "",
      tgId,
      data,
    ]);
  }

  // Faixas: reescreve tudo (apaga as antigas e insere as atuais na ordem enviada).
  if (isEdit) {
    const faixasRows = await googleSheetsService.usuarios.readValues(SHEETS.faixas);
    const keepIndexes = faixasRows
      .map((row, i) => ({ row, i }))
      .filter(({ row, i }) => i > 0 && normalizeText(row[0]) !== id);
    const header = faixasRows[0] || [];
    const rewritten = [header, ...keepIndexes.map(({ row }) => row)];
    await googleSheetsService.usuarios.updateValues(
      SHEETS.faixas,
      `A1:H${Math.max(rewritten.length, faixasRows.length)}`,
      rewritten.map((row) => {
        const padded = [...row];
        while (padded.length < 8) padded.push("");
        return padded.slice(0, 8);
      }),
    );
  }

  for (let i = 0; i < (payload.tracks || []).length; i += 1) {
    const t = payload.tracks![i];
    await googleSheetsService.usuarios.appendRow(SHEETS.faixas, [
      id,
      String(i + 1),
      t.album_id || "",
      String(t.faixa_numero || ""),
      t.titulo || "",
      t.artistas || "",
      t.drive_url || "",
      t.capa_url || "",
    ]);
  }

  return jsonResponse({ ok: true, id });
}

// -------------------- EXCLUIR --------------------

export async function deletePlaylistController(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as { id?: string; tgId?: string };
  if (!body.id) return jsonResponse({ ok: false, error: "id obrigatório." }, 400);

  const playlistRows = await googleSheetsService.usuarios.readValues(SHEETS.playlists);
  const rowIndex = playlistRows.findIndex((row, i) => i > 0 && normalizeText(row[0]) === body.id);
  if (rowIndex === -1) return jsonResponse({ ok: false, error: "Playlist não encontrada." }, 404);

  const ownerTgId = normalizeText(playlistRows[rowIndex][5]);
  if (ownerTgId && body.tgId && ownerTgId !== body.tgId && body.tgId !== "810141686") {
    return jsonResponse({ ok: false, error: "Sem permissão para excluir essa playlist." }, 403);
  }

  await googleSheetsService.usuarios.updateValues(SHEETS.playlists, `A${rowIndex + 1}`, [[""]]);

  return jsonResponse({ ok: true });
}

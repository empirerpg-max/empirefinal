import { googleSheetsService, normalizeText } from "../services/googleSheetsService";
import { ADMIN_TG_ID, requestProvesAdmin } from "../services/sessionService";

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
  letra?: string;
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
    const claimsAdmin = tgId.trim() === ADMIN_TG_ID;
    const isAdmin = claimsAdmin && (await requestProvesAdmin(request));
    if (ownerTgId && tgId && ownerTgId !== tgId && !isAdmin) {
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
  const [albunsRows, faixasRows] = await Promise.all([readAlbunsAntigosRows(), readFaixasAntigasRows()]);

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
        letra: normalizeText(row[6]) || undefined,
      };
    })
    .filter((f) => f.titulo && f.drive_url);

  return jsonResponse(faixas);
}

async function readAlbunsAntigosRows(): Promise<string[][]> {
  const rows = await googleSheetsService.usuarios.readValues(SHEET_ALBUNS);
  return rows.slice(1).filter((row) => row.some((cell) => normalizeText(cell)));
}

async function readFaixasAntigasRows(): Promise<string[][]> {
  const rows = await googleSheetsService.usuarios.readValues(SHEET_FAIXAS);
  return rows.slice(1).filter((row) => row.some((cell) => normalizeText(cell)));
}

function faixaAntigaFromRow(row: string[]) {
  return {
    numero: Number(row[1]) || 0,
    titulo: normalizeText(row[2]),
    artistas: normalizeText(row[3]),
    duracao: normalizeText(row[4]) || undefined,
    drive_url: normalizeText(row[5]),
    letra: normalizeText(row[6]) || undefined,
  };
}

// -------------------- ÁLBUNS ANTIGOS (galeria, listagem/detalhe) --------------------

export async function getAlbunsAntigosController(): Promise<Response> {
  const [albunsRows, faixasRows] = await Promise.all([readAlbunsAntigosRows(), readFaixasAntigasRows()]);

  const faixasCountByAlbum = new Map<string, number>();
  for (const row of faixasRows) {
    const albumId = normalizeText(row[0]);
    faixasCountByAlbum.set(albumId, (faixasCountByAlbum.get(albumId) || 0) + 1);
  }

  const albuns = albunsRows
    .map((row) => {
      const id = normalizeText(row[0]);
      return {
        id,
        artista: normalizeText(row[1]),
        titulo: normalizeText(row[2]),
        genero: normalizeText(row[3]) || undefined,
        data: normalizeText(row[4]) || undefined,
        descricao: normalizeText(row[5]) || undefined,
        capa_url: normalizeText(row[6]) || undefined,
        totalFaixas: faixasCountByAlbum.get(id) || 0,
      };
    })
    .filter((a) => a.id && a.titulo);

  albuns.sort((a, b) => new Date(b.data || 0).getTime() - new Date(a.data || 0).getTime());

  return jsonResponse(albuns);
}

export async function getAlbumAntigoByIdController(id: string): Promise<Response> {
  const [albunsRows, faixasRows] = await Promise.all([readAlbunsAntigosRows(), readFaixasAntigasRows()]);
  const row = albunsRows.find((r) => normalizeText(r[0]) === id);
  if (!row) return jsonResponse({ error: "Álbum não encontrado." }, 404);

  const faixas = faixasRows
    .filter((r) => normalizeText(r[0]) === id)
    .map(faixaAntigaFromRow)
    .sort((a, b) => a.numero - b.numero);

  return jsonResponse({
    id,
    artista: normalizeText(row[1]),
    titulo: normalizeText(row[2]),
    genero: normalizeText(row[3]) || undefined,
    data: normalizeText(row[4]) || undefined,
    descricao: normalizeText(row[5]) || undefined,
    capa_url: normalizeText(row[6]) || undefined,
    contracapa_url: normalizeText(row[7]) || undefined,
    encarte: parseEncarte(row[8]),
    telegram_id: normalizeText(row[9]) || undefined,
    faixas,
  });
}

function parseEncarte(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string" && x) : [];
  } catch {
    return [];
  }
}

// -------------------- ÁLBUM ANTIGO (cadastro manual em Playlists_Albuns) --------------------

interface FaixaAntigaInput {
  numero: number;
  titulo: string;
  artistas: string;
  duracao?: string;
  drive_url: string;
  letra?: string;
}

export async function criarAlbumAntigoController(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as {
    artista?: string;
    titulo?: string;
    genero?: string;
    data?: string;
    descricao?: string;
    capa_url?: string;
    contracapa_url?: string;
    encarte?: string[];
    telegram_id?: string;
    faixas?: FaixaAntigaInput[];
  };

  if (!body.artista?.trim() || !body.titulo?.trim() || !body.faixas?.length) {
    return jsonResponse({ ok: false, error: "Artista, título e ao menos uma faixa são obrigatórios." }, 400);
  }
  if (body.faixas.some((f) => !f.titulo?.trim() || !f.drive_url?.trim())) {
    return jsonResponse({ ok: false, error: "Toda faixa precisa de título e link/arquivo." }, 400);
  }

  const albumId = `ALB-${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;
  const dataLancamento = body.data || new Date().toISOString().slice(0, 10);

  // Sem try/catch aqui de propósito — se a linha do álbum não gravar, ele
  // não existe de verdade, então a falha deve propagar e responder
  // ok:false, nunca fingir sucesso.
  //
  // Range travado em "A:K" (não o default "A:ZZ") — com um range aberto, a
  // API de append do Sheets às vezes "erra" a coluna de início quando tenta
  // detectar os limites da tabela (bug real já visto: linha inteira
  // gravada 8 colunas deslocada pra direita, começando em I em vez de A).
  // Um range fechado do tamanho exato da linha elimina essa ambiguidade.
  await googleSheetsService.usuarios.appendRow(
    SHEET_ALBUNS,
    [
      albumId,
      body.artista.trim(),
      body.titulo.trim(),
      body.genero?.trim() || "",
      dataLancamento,
      body.descricao?.trim() || "",
      body.capa_url || "",
      body.contracapa_url || "",
      JSON.stringify(body.encarte?.filter(Boolean) || []),
      body.telegram_id || "",
      new Date().toISOString(),
    ],
    "A:K",
  );

  // Isolamento por faixa: uma falha no meio da lista não pode travar as
  // faixas seguintes nem fazer o álbum voltar "ok:true" fingindo que todas
  // as faixas foram gravadas quando só uma parte foi de verdade.
  let faixasGravadas = 0;
  for (const f of body.faixas) {
    try {
      await googleSheetsService.usuarios.appendRow(
        SHEET_FAIXAS,
        [
          albumId,
          String(f.numero || ""),
          f.titulo.trim(),
          f.artistas?.trim() || body.artista.trim(),
          f.duracao || "",
          f.drive_url.trim(),
          f.letra || "",
        ],
        "A:G",
      );
      faixasGravadas++;
    } catch (err) {
      console.warn("[criarAlbumAntigoController] Erro ao gravar faixa:", f.titulo, err);
    }
  }

  const faltaram = body.faixas.length - faixasGravadas;
  return jsonResponse({
    ok: true,
    id: albumId,
    faixasGravadas,
    faixasEsperadas: body.faixas.length,
    error:
      faltaram > 0
        ? `Álbum registrado, mas ${faltaram} faixa(s) falharam ao gravar — confira e adicione de novo se precisar.`
        : undefined,
  });
}

// Só o dono (telegram_id da coluna J) ou admin (810141686) pode editar/
// excluir — mesma regra usada em outros lugares do app (posts sociais,
// artistas etc).
async function podeEditarAlbumAntigo(row: string[], tgId: string, request: Request): Promise<boolean> {
  if (tgId.trim() === ADMIN_TG_ID && (await requestProvesAdmin(request))) return true;
  const owner = normalizeText(row[9]);
  return !!owner && owner === tgId.trim();
}

export async function editarAlbumAntigoController(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as {
    id?: string;
    tgId?: string;
    artista?: string;
    titulo?: string;
    genero?: string;
    data?: string;
    descricao?: string;
    capa_url?: string;
    contracapa_url?: string;
    faixas?: FaixaAntigaInput[];
  };
  const id = (body.id || "").trim();
  const tgId = (body.tgId || "").trim();
  if (!id || !tgId || !body.artista?.trim() || !body.titulo?.trim() || !body.faixas?.length) {
    return jsonResponse({ ok: false, error: "Dados incompletos para editar o álbum." }, 400);
  }
  if (body.faixas.some((f) => !f.titulo?.trim() || !f.drive_url?.trim())) {
    return jsonResponse({ ok: false, error: "Toda faixa precisa de título e link/arquivo." }, 400);
  }

  const albunsRows = await googleSheetsService.usuarios.readValues(SHEET_ALBUNS);
  const rowIndex = albunsRows.findIndex((r, i) => i > 0 && normalizeText(r[0]) === id);
  if (rowIndex === -1) return jsonResponse({ ok: false, error: "Álbum não encontrado." }, 404);
  if (!(await podeEditarAlbumAntigo(albunsRows[rowIndex], tgId, request))) {
    return jsonResponse({ ok: false, error: "Você só pode editar seus próprios álbuns." }, 403);
  }

  await googleSheetsService.usuarios.updateValues(SHEET_ALBUNS, `B${rowIndex + 1}:H${rowIndex + 1}`, [
    [
      body.artista.trim(),
      body.titulo.trim(),
      body.genero?.trim() || "",
      body.data || normalizeText(albunsRows[rowIndex][4]),
      body.descricao?.trim() || "",
      body.capa_url || normalizeText(albunsRows[rowIndex][6]),
      body.contracapa_url || normalizeText(albunsRows[rowIndex][7]),
    ],
  ]);

  // Substitui as faixas: limpa (em branco) todas as linhas atuais desse
  // álbum e grava a lista nova do zero — mais simples e seguro do que
  // tentar casar faixa a faixa por posição.
  const faixasRows = await googleSheetsService.usuarios.readValues(SHEET_FAIXAS);
  for (let i = 1; i < faixasRows.length; i++) {
    if (normalizeText(faixasRows[i][0]) === id) {
      await googleSheetsService.usuarios.updateValues(SHEET_FAIXAS, `A${i + 1}:G${i + 1}`, [
        ["", "", "", "", "", "", ""],
      ]);
    }
  }
  for (const f of body.faixas) {
    await googleSheetsService.usuarios.appendRow(
      SHEET_FAIXAS,
      [
        id,
        String(f.numero || ""),
        f.titulo.trim(),
        f.artistas?.trim() || body.artista.trim(),
        f.duracao || "",
        f.drive_url.trim(),
        f.letra || "",
      ],
      "A:G",
    );
  }

  return jsonResponse({ ok: true });
}

export async function deletarAlbumAntigoController(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as { id?: string; tgId?: string };
  const id = (body.id || "").trim();
  const tgId = (body.tgId || "").trim();
  if (!id || !tgId) {
    return jsonResponse({ ok: false, error: "id e tgId são obrigatórios." }, 400);
  }

  const albunsRows = await googleSheetsService.usuarios.readValues(SHEET_ALBUNS);
  const rowIndex = albunsRows.findIndex((r, i) => i > 0 && normalizeText(r[0]) === id);
  if (rowIndex === -1) return jsonResponse({ ok: false, error: "Álbum não encontrado." }, 404);
  if (!(await podeEditarAlbumAntigo(albunsRows[rowIndex], tgId, request))) {
    return jsonResponse({ ok: false, error: "Você só pode excluir seus próprios álbuns." }, 403);
  }

  await googleSheetsService.usuarios.updateValues(SHEET_ALBUNS, `A${rowIndex + 1}:K${rowIndex + 1}`, [
    ["", "", "", "", "", "", "", "", "", "", ""],
  ]);

  const faixasRows = await googleSheetsService.usuarios.readValues(SHEET_FAIXAS);
  for (let i = 1; i < faixasRows.length; i++) {
    if (normalizeText(faixasRows[i][0]) === id) {
      await googleSheetsService.usuarios.updateValues(SHEET_FAIXAS, `A${i + 1}:G${i + 1}`, [
        ["", "", "", "", "", "", ""],
      ]);
    }
  }

  return jsonResponse({ ok: true });
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
  const claimsAdmin = (body.tgId || "").trim() === ADMIN_TG_ID;
  const isAdmin = claimsAdmin && (await requestProvesAdmin(request));
  if (ownerTgId && body.tgId && ownerTgId !== body.tgId && !isAdmin) {
    return jsonResponse({ ok: false, error: "Sem permissão para excluir essa playlist." }, 403);
  }

  await googleSheetsService.usuarios.updateValues(SHEET, `A${rowIndex + 1}`, [[""]]);

  return jsonResponse({ ok: true });
}

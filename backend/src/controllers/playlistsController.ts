import { googleSheetsService, normalizeText, normalizeComparison, dedupeHeaders, normalizeHeader } from "../services/googleSheetsService";
import { ADMIN_TG_ID, requestProvesAdmin } from "../services/sessionService";
import {
  publicarAlbum,
  completarAlbumExistente,
  registrarAlbumNaEdicaoChartsAlbuns,
  calcularSemanasRetroativas,
  dedupeArtistPrefix,
  type CreateAlbumPayload,
} from "./gestaoController";

function tituloCompletoDaFaixa(titulo: string, artista: string): string {
  const semPrefixoDuplicado = dedupeArtistPrefix(titulo, artista);
  return semPrefixoDuplicado.includes(" - ") ? semPrefixoDuplicado : `${artista} - ${semPrefixoDuplicado}`;
}

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

// A API de :append do Sheets, quando o range é aberto ou até quando é
// travado numa aba com muita coisa gravada, pode "errar" a linha/coluna de
// início ao tentar detectar os limites reais da tabela — já visto ao vivo
// travando o range em A:K e mesmo assim a linha inteira caindo deslocada
// (efeito relatado aqui: álbum legado gravado em colunas diferentes do
// esperado, faixas também). O único jeito confiável já confirmado nesta
// planilha é nunca usar :append — ler a coluna-âncora, achar a última linha
// com conteúdo de verdade e escrever direto nessa linha via updateValues.
async function proximaLinhaLivre(sheetName: string, colunaAncora: string): Promise<number> {
  const rows = await googleSheetsService.usuarios.readValues(sheetName, `${colunaAncora}2:${colunaAncora}20000`);
  let ultimaComConteudo = 1; // linha 1 = cabeçalho
  for (let i = 0; i < rows.length; i++) {
    if ((rows[i]?.[0] || "").toString().trim()) ultimaComConteudo = i + 2;
  }
  return ultimaComConteudo + 1;
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

// Resolve o nome oficial (aba "Usuários") a partir do telegram_id gravado
// no álbum legado — sem isso a migração publicaria tudo como "Jogador".
async function resolveNomeOficial(telegramId: string, fallback: string): Promise<string> {
  if (!telegramId) return fallback;
  try {
    const rows = await googleSheetsService.usuarios.readValues("Usuários");
    if (!rows || rows.length < 2) return fallback;
    const headers = dedupeHeaders(
      "Usuários",
      rows[0].map((h, i) => normalizeHeader(h) || `coluna_${i + 1}`),
    );
    const nomeCol = headers.indexOf("nome");
    const idCol = headers.indexOf("id");
    if (nomeCol === -1 || idCol === -1) return fallback;
    const normId = normalizeComparison(telegramId);
    const match = rows.slice(1).find((r) => normalizeComparison(r[idCol]) === normId);
    const nome = match ? normalizeText(match[nomeCol]) : "";
    return nome || fallback;
  } catch {
    return fallback;
  }
}

// Diagnóstico pontual: acha faixas duplicadas em "Musicas" E em "EDIÇÃO
// CHARTS" (mesmo título completo aparecendo em mais de 1 linha na mesma
// aba) causadas pela migração de álbuns legados ter rodado ANTES da
// checagem de duplicidade existir — cada duplicata lista as linhas (a
// original, publicada de verdade, e a que a migração criou por cima) pra
// decidir manualmente qual apagar. Só lê, não apaga nada sozinho — apagar
// errado é mais perigoso que deixar a duplicata até alguém confirmar qual
// linha é a sobra.
export async function diagnosticoDuplicatasLegadosController(): Promise<Response> {
  const [albunsLegadosRows, faixasLegadasRows, musicasRows, edicaoChartsRows] = await Promise.all([
    readAlbunsAntigosRows(),
    readFaixasAntigasRows(),
    googleSheetsService.principal.readValues("Musicas"),
    googleSheetsService.edicaoCharts.readValues("EDIÇÃO CHARTS", "A2:F20000"),
  ]);

  // linha real na planilha = índice no array + 1 (linha 1 é cabeçalho, e
  // readValues devolve a partir da linha 1 também, então rows[i] = linha i+1)
  const musicasPorTitulo = new Map<string, { linha: number; topicId: string; pendente: string; album: string }[]>();
  for (let i = 1; i < musicasRows.length; i++) {
    const row = musicasRows[i];
    const titulo = normalizeText(row?.[7]);
    if (!titulo) continue;
    const key = normalizeComparison(titulo);
    if (!musicasPorTitulo.has(key)) musicasPorTitulo.set(key, []);
    musicasPorTitulo.get(key)!.push({
      linha: i + 1,
      topicId: normalizeText(row[1]),
      pendente: normalizeText(row[23]),
      album: normalizeText(row[10]),
    });
  }

  // "EDIÇÃO CHARTS" lido a partir de A2, então rows[i] = linha i+2.
  const edicaoChartsPorTitulo = new Map<string, { linha: number; album: string; weeks: string }[]>();
  for (let i = 0; i < (edicaoChartsRows || []).length; i++) {
    const row = edicaoChartsRows[i];
    const titulo = normalizeText(row?.[1]); // B
    if (!titulo) continue;
    const key = normalizeComparison(titulo);
    if (!edicaoChartsPorTitulo.has(key)) edicaoChartsPorTitulo.set(key, []);
    edicaoChartsPorTitulo.get(key)!.push({ linha: i + 2, album: normalizeText(row[4]), weeks: normalizeText(row[5]) });
  }

  const duplicatasMusicas: {
    titulo: string;
    ocorrencias: { linha: number; topicId: string; pendente: string; album: string }[];
  }[] = [];
  const duplicatasEdicaoCharts: {
    titulo: string;
    ocorrencias: { linha: number; album: string; weeks: string }[];
  }[] = [];

  for (const row of albunsLegadosRows) {
    const artista = normalizeText(row[1]);
    const albumId = normalizeText(row[0]);
    if (!artista) continue;
    const faixas = faixasLegadasRows.filter((r) => normalizeText(r[0]) === albumId).map(faixaAntigaFromRow);
    for (const f of faixas) {
      const tituloCompleto = tituloCompletoDaFaixa(f.titulo, artista);
      const key = normalizeComparison(tituloCompleto);

      const ocorrenciasMusicas = musicasPorTitulo.get(key);
      if (ocorrenciasMusicas && ocorrenciasMusicas.length > 1) {
        if (!duplicatasMusicas.some((d) => normalizeComparison(d.titulo) === key)) {
          duplicatasMusicas.push({ titulo: tituloCompleto, ocorrencias: ocorrenciasMusicas });
        }
      }

      const ocorrenciasCharts = edicaoChartsPorTitulo.get(key);
      if (ocorrenciasCharts && ocorrenciasCharts.length > 1) {
        if (!duplicatasEdicaoCharts.some((d) => normalizeComparison(d.titulo) === key)) {
          duplicatasEdicaoCharts.push({ titulo: tituloCompleto, ocorrencias: ocorrenciasCharts });
        }
      }
    }
  }

  return jsonResponse({
    success: true,
    totalDuplicatas: duplicatasMusicas.length + duplicatasEdicaoCharts.length,
    comoLer:
      "'duplicatasMusicas': linhas em Musicas com o mesmo título — a com topicId preenchido é a original, a outra (pendente:'Sim', topicId vazio) foi criada pela migração e pode ser apagada com sheet:'Musicas'. 'duplicatasEdicaoCharts': linhas em EDIÇÃO CHARTS com o mesmo título — não dá pra saber automaticamente qual é a sobra (não tem campo 'pendente' aqui), confira manualmente pelas outras colunas antes de apagar com sheet:'EdicaoCharts'.",
    duplicatasMusicas,
    duplicatasEdicaoCharts,
  });
}

// Apaga (esvazia) a linha estranha de uma faixa duplicada em "Musicas" ou
// em "EDIÇÃO CHARTS" (parâmetro `sheet`) — usado depois de conferir o
// diagnóstico acima. Em "Musicas", só apaga se a linha bater EXATAMENTE
// com o perfil de "criada pela migração por engano": título igual ao
// esperado, sem tópico próprio (B vazio) e Pendente = "Sim" — uma faixa
// publicada de verdade (com tópico) NUNCA é apagada por esse endpoint,
// mesmo que o título bata, por segurança. Em "EDIÇÃO CHARTS" não existe
// esse mesmo sinal de segurança (não tem "pendente"), então só apaga se o
// título bater e a linha for informada explicitamente — confirme pelo
// diagnóstico antes.
// Mescla 2 tópicos de música duplicados (mesma faixa, dois tópicos
// diferentes) sem perder comentário: move todo comentário do tópico
// `remover` (Comentarios_Musicas!A) pro tópico `manter`, e só depois
// apaga a linha em Musicas do tópico `remover`. O tópico `manter` fica
// como o único de verdade, agora com os comentários dos dois.
// GET com querystring (mesmo padrão de apagar-faixa-duplicada — só abrir
// o link no navegador) ou POST com JSON.
export async function mesclarTopicosMusicaController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const body =
    request.method === "GET"
      ? { manter: url.searchParams.get("manter"), remover: url.searchParams.get("remover") }
      : ((await request.json().catch(() => ({}))) as { manter?: string | null; remover?: string | null });
  const manter = normalizeText(body.manter || "");
  const remover = normalizeText(body.remover || "");
  if (!manter || !remover || manter === remover) {
    return jsonResponse(
      { success: false, error: "Parâmetros 'manter' e 'remover' são obrigatórios e precisam ser diferentes." },
      400,
    );
  }

  // 1. Confirma que os dois tópicos existem em Musicas antes de mexer em
  // qualquer coisa — evita mesclar comentário pra um tópico que nem
  // existe (erro de digitação no ID) ou apagar a faixa errada.
  const musicasRows = await googleSheetsService.principal.readValues("Musicas");
  const linhaManter = musicasRows.findIndex((r, i) => i > 0 && normalizeText(r[1]) === manter);
  const linhaRemover = musicasRows.findIndex((r, i) => i > 0 && normalizeText(r[1]) === remover);
  if (linhaManter < 1) return jsonResponse({ success: false, error: `Tópico 'manter' (${manter}) não encontrado em Musicas.` }, 404);
  if (linhaRemover < 1) return jsonResponse({ success: false, error: `Tópico 'remover' (${remover}) não encontrado em Musicas.` }, 404);

  const tituloManter = normalizeText(musicasRows[linhaManter][7]);
  const tituloRemover = normalizeText(musicasRows[linhaRemover][7]);

  // 2. Move os comentários (Comentarios_Musicas!A = ID do tópico).
  const comentariosRows = await googleSheetsService.principal.readValues("Comentarios_Musicas");
  let comentariosMovidos = 0;
  for (let i = 1; i < comentariosRows.length; i++) {
    if (normalizeText(comentariosRows[i][0]) !== remover) continue;
    await googleSheetsService.principal.updateValues("Comentarios_Musicas", `A${i + 1}`, [[manter]]);
    comentariosMovidos++;
  }

  // 3. Só agora apaga a linha duplicada em Musicas (a do tópico `remover`).
  await googleSheetsService.principal.updateValues("Musicas", `A${linhaRemover + 1}:Y${linhaRemover + 1}`, [
    Array(25).fill(""),
  ]);

  return jsonResponse({
    success: true,
    manter: { topicId: manter, titulo: tituloManter },
    removido: { topicId: remover, titulo: tituloRemover },
    comentariosMovidos,
  });
}

// Mesma ideia de mesclarTopicosMusicaController, mas pra 2 ÁLBUNS
// duplicados (título ligeiramente diferente escapou da checagem de
// idempotência da migração de legados, ex: "villain [deluxe]" vs "villain
// [deluxe edition]" — títulos "quase iguais" pro humano, diferentes pro
// normalizeComparison por causa da palavra a mais). Identifica os 2 álbuns
// pelo título completo ("Artista - Título", coluna G de Albuns), não por
// número de linha (mais robusto a planilha ter mudado entre o diagnóstico
// e a chamada). Passos, nessa ordem — sempre `manter` primeiro, e só apaga
// depois de mover tudo:
// 1. Move comentários do álbum `remover` (Comentarios_Albuns!A = ID do
//    tópico) pro álbum `manter`.
// 2. Repointa (não apaga) qualquer faixa em Musicas/EDIÇÃO CHARTS cujo
//    campo ÁLBUM apontava pro título `remover`, passando a apontar pro
//    `manter` — protege contra o caso (não confirmado, mas não impossível)
//    de a migração ter criado alguma faixa nova vinculada ao álbum
//    duplicado.
// 3. Apaga a linha do álbum `remover` em Albuns.
// 4. Apaga a linha correspondente em EDIÇÃO CHARTS ÁLBUMS (achada pelo
//    mesmo título, coluna D).
export async function mesclarAlbunsDuplicadosController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const body =
    request.method === "GET"
      ? { manter: url.searchParams.get("manter"), remover: url.searchParams.get("remover") }
      : ((await request.json().catch(() => ({}))) as { manter?: string | null; remover?: string | null });
  const manter = normalizeText(body.manter || "");
  const remover = normalizeText(body.remover || "");
  if (!manter || !remover || normalizeComparison(manter) === normalizeComparison(remover)) {
    return jsonResponse(
      { success: false, error: "Parâmetros 'manter' e 'remover' são obrigatórios e precisam ser diferentes (título completo 'Artista - Título')." },
      400,
    );
  }
  const manterKey = normalizeComparison(manter);
  const removerKey = normalizeComparison(remover);

  // 1. Localiza os 2 álbuns em Albuns (coluna G = índice 6).
  const albunsRows = await googleSheetsService.principal.readValues("Albuns");
  const linhaManter = albunsRows.findIndex((r, i) => i > 0 && normalizeComparison(normalizeText(r[6])) === manterKey);
  const linhaRemover = albunsRows.findIndex((r, i) => i > 0 && normalizeComparison(normalizeText(r[6])) === removerKey);
  if (linhaManter < 1) return jsonResponse({ success: false, error: `Álbum 'manter' ("${manter}") não encontrado em Albuns.` }, 404);
  if (linhaRemover < 1) return jsonResponse({ success: false, error: `Álbum 'remover' ("${remover}") não encontrado em Albuns.` }, 404);

  const tituloManter = normalizeText(albunsRows[linhaManter][6]);
  const tituloRemover = normalizeText(albunsRows[linhaRemover][6]);
  const topicIdManter = normalizeText(albunsRows[linhaManter][1]);
  const topicIdRemover = normalizeText(albunsRows[linhaRemover][1]);

  // 2. Move comentários (Comentarios_Albuns!A = ID do tópico).
  const comentariosRows = await googleSheetsService.principal.readValues("Comentarios_Albuns");
  let comentariosMovidos = 0;
  for (let i = 1; i < comentariosRows.length; i++) {
    if (normalizeText(comentariosRows[i][0]) !== topicIdRemover) continue;
    await googleSheetsService.principal.updateValues("Comentarios_Albuns", `A${i + 1}`, [[topicIdManter]]);
    comentariosMovidos++;
  }

  // 3. Repointa qualquer faixa (Musicas!K / EDIÇÃO CHARTS!E) que ainda
  // apontava pro título do álbum removido.
  const musicasRows = await googleSheetsService.principal.readValues("Musicas");
  let faixasRepointadasMusicas = 0;
  for (let i = 1; i < musicasRows.length; i++) {
    if (normalizeComparison(normalizeText(musicasRows[i][10])) !== removerKey) continue;
    await googleSheetsService.principal.updateValues("Musicas", `K${i + 1}`, [[tituloManter]]);
    faixasRepointadasMusicas++;
  }
  const edicaoChartsRows = await googleSheetsService.edicaoCharts.readValues("EDIÇÃO CHARTS");
  let faixasRepointadasEdicaoCharts = 0;
  for (let i = 1; i < edicaoChartsRows.length; i++) {
    if (normalizeComparison(normalizeText(edicaoChartsRows[i][4])) !== removerKey) continue;
    await googleSheetsService.edicaoCharts.updateValues("EDIÇÃO CHARTS", `E${i + 1}`, [[tituloManter]]);
    faixasRepointadasEdicaoCharts++;
  }

  // 4. Apaga a linha do álbum duplicado em Albuns (A:L).
  await googleSheetsService.principal.updateValues("Albuns", `A${linhaRemover + 1}:L${linhaRemover + 1}`, [
    Array(12).fill(""),
  ]);

  // 5. Apaga a linha correspondente em EDIÇÃO CHARTS ÁLBUMS (coluna D = índice 3).
  const edicaoChartsAlbunsRows = await googleSheetsService.edicaoCharts.readValues("EDIÇÃO CHARTS ÁLBUMS");
  const linhaEdChartsAlbum = edicaoChartsAlbunsRows.findIndex(
    (r, i) => i > 0 && normalizeComparison(normalizeText(r[3])) === removerKey,
  );
  let edicaoChartsAlbunsApagada = false;
  if (linhaEdChartsAlbum >= 1) {
    await googleSheetsService.edicaoCharts.updateValues(
      "EDIÇÃO CHARTS ÁLBUMS",
      `A${linhaEdChartsAlbum + 1}:R${linhaEdChartsAlbum + 1}`,
      [Array(18).fill("")],
    );
    edicaoChartsAlbunsApagada = true;
  }

  return jsonResponse({
    success: true,
    manter: { topicId: topicIdManter, titulo: tituloManter },
    removido: { topicId: topicIdRemover, titulo: tituloRemover },
    comentariosMovidos,
    faixasRepointadasMusicas,
    faixasRepointadasEdicaoCharts,
    edicaoChartsAlbunsApagada,
  });
}

// Diagnóstico pontual: por que um álbum específico (identificado pelo
// título completo "Artista - Título") ficou sem faixas depois da migração
// de legados. Mostra os 4 lugares que importam, lado a lado, pra achar
// exatamente em qual etapa a faixa se perdeu: (1) a fonte legada
// (Playlists_Albuns/Playlists_Faixas), (2) a linha em Albuns, (3) qualquer
// linha em Musicas cujo ÁLBUM aponte pra esse título, (4) a entrada em
// EDIÇÃO CHARTS ÁLBUMS.
export async function diagnosticoAlbumLegadoController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const tituloCompleto = normalizeText(url.searchParams.get("titulo") || "");
  if (!tituloCompleto) {
    return jsonResponse({ success: false, error: "Parâmetro 'titulo' (completo, 'Artista - Título') é obrigatório." }, 400);
  }
  const key = normalizeComparison(tituloCompleto);

  const [albunsLegadosRows, faixasLegadasRows, albunsRows, musicasRows, edicaoChartsAlbunsRows, edicaoChartsRows] = await Promise.all([
    readAlbunsAntigosRows(),
    readFaixasAntigasRows(),
    googleSheetsService.principal.readValues("Albuns"),
    googleSheetsService.principal.readValues("Musicas"),
    googleSheetsService.edicaoCharts.readValues("EDIÇÃO CHARTS ÁLBUMS"),
    googleSheetsService.edicaoCharts.readValues("EDIÇÃO CHARTS"),
  ]);

  // 1. Fonte legada.
  const legadoRow = albunsLegadosRows.find((r) => {
    const artista = normalizeText(r[1]);
    const titulo = normalizeText(r[2]);
    return artista && titulo && normalizeComparison(`${artista} - ${titulo}`) === key;
  });
  const legadoAlbumId = legadoRow ? normalizeText(legadoRow[0]) : null;
  const faixasLegadas = legadoAlbumId
    ? faixasLegadasRows.filter((r) => normalizeText(r[0]) === legadoAlbumId).map(faixaAntigaFromRow)
    : [];

  // 2. TODAS as linhas em Albuns com esse título — não só a primeira, pra
  // não esconder duplicata (mesmo bug do findIndex que já mordeu antes:
  // um merge anterior podia ter deixado 2+ linhas e um findIndex só
  // reportaria a primeira, escondendo a duplicata que o usuário via na
  // planilha).
  const albunsOcorrencias: { linha: number; topicId: string; data: string; novoNome: string; tipo: string; codigoUnico: string }[] = [];
  for (let i = 1; i < albunsRows.length; i++) {
    if (normalizeComparison(normalizeText(albunsRows[i][6])) !== key) continue;
    albunsOcorrencias.push({
      linha: i + 1,
      topicId: normalizeText(albunsRows[i][1]),
      data: normalizeText(albunsRows[i][0]),
      novoNome: normalizeText(albunsRows[i][6]),
      tipo: normalizeText(albunsRows[i][10]),
      codigoUnico: normalizeText(albunsRows[i][11]),
    });
  }

  // 3. Faixas em Musicas cujo ÁLBUM (coluna K) aponta pra esse título.
  const faixasEmMusicas: { linha: number; titulo: string; topicId: string }[] = [];
  for (let i = 1; i < musicasRows.length; i++) {
    if (normalizeComparison(normalizeText(musicasRows[i][10])) !== key) continue;
    faixasEmMusicas.push({ linha: i + 1, titulo: normalizeText(musicasRows[i][7]), topicId: normalizeText(musicasRows[i][1]) });
  }

  // 4. TODAS as linhas em EDIÇÃO CHARTS ÁLBUMS com esse título (mesmo
  // motivo do item 2 acima).
  const edicaoChartsAlbunsOcorrencias: { linha: number; data: string; semanas: string; numeroFaixas: string; codigoUnico: string }[] = [];
  for (let i = 1; i < edicaoChartsAlbunsRows.length; i++) {
    if (normalizeComparison(normalizeText(edicaoChartsAlbunsRows[i][3])) !== key) continue;
    edicaoChartsAlbunsOcorrencias.push({
      linha: i + 1,
      data: normalizeText(edicaoChartsAlbunsRows[i][1]),
      semanas: normalizeText(edicaoChartsAlbunsRows[i][2]),
      numeroFaixas: normalizeText(edicaoChartsAlbunsRows[i][4]),
      codigoUnico: normalizeText(edicaoChartsAlbunsRows[i][17]),
    });
  }

  // 5. Pra cada faixa da fonte legada, se o título completo dela ("Artista
  // - Título") já existe em EDIÇÃO CHARTS (coluna B) mesmo sem existir em
  // Musicas — é exatamente esse comportamento que faz a migração achar
  // "já existe, não é nova" e nunca tentar de novo, mesmo com a faixa
  // ausente de Musicas.
  const artistaLegado = legadoRow ? normalizeText(legadoRow[1]) : "";
  const edicaoChartsPorFaixa = faixasLegadas.map((f) => {
    const tituloCompletoFaixa = f.titulo.includes(" - ") ? f.titulo : `${artistaLegado} - ${f.titulo}`;
    const keyFaixa = normalizeComparison(tituloCompletoFaixa);
    const linha = edicaoChartsRows.findIndex((r, i) => i > 0 && normalizeComparison(normalizeText(r[1])) === keyFaixa);
    return { titulo: tituloCompletoFaixa, existeEmEdicaoCharts: linha >= 1, linhaEdicaoCharts: linha >= 1 ? linha + 1 : null };
  });

  return jsonResponse({
    success: true,
    tituloBuscado: tituloCompleto,
    legado: legadoRow
      ? {
          albumId: legadoAlbumId,
          artista: normalizeText(legadoRow[1]),
          titulo: normalizeText(legadoRow[2]),
          totalFaixasNaFonte: faixasLegadas.length,
          // Sem "letra" aqui de propósito — só polui a resposta, e não
          // ajuda a diagnosticar onde a faixa se perdeu.
          faixas: faixasLegadas.map(({ letra, ...resto }) => resto),
        }
      : { encontrado: false, obs: "Não existe em Playlists_Albuns com esse título — não tinha o que migrar." },
    albuns: { totalOcorrencias: albunsOcorrencias.length, ocorrencias: albunsOcorrencias },
    musicas: { totalFaixasApontandoPraEsseAlbum: faixasEmMusicas.length, faixas: faixasEmMusicas },
    edicaoChartsAlbuns: { totalOcorrencias: edicaoChartsAlbunsOcorrencias.length, ocorrencias: edicaoChartsAlbunsOcorrencias },
    // Se alguma faixa aqui estiver "existeEmEdicaoCharts: true" sem
    // aparecer em "musicas" acima, é a causa raiz: a migração acha que ela
    // já existe (bloqueando novas tentativas) mesmo sem ter Musicas.
    edicaoChartsPorFaixa,
  });
}

// Dump bruto de um intervalo de linhas, sem NENHUM filtro por título —
// último recurso quando o diagnóstico por título não bate com o que
// aparece na planilha (ex: espaço/acento/caractere invisível diferente
// faz normalizeComparison não casar duas strings que parecem idênticas
// no olho, escondendo uma linha inteira do diagnóstico por título).
export async function dumpLinhasController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const sheet = normalizeText(url.searchParams.get("sheet") || "");
  const de = Number(url.searchParams.get("de")) || 1;
  const ate = Number(url.searchParams.get("ate")) || de + 20;
  if (!sheet) return jsonResponse({ success: false, error: "Parâmetro 'sheet' obrigatório: Albuns | EDIÇÃO CHARTS ÁLBUMS | Musicas | EDIÇÃO CHARTS." }, 400);

  const isEdicaoCharts = sheet.toUpperCase().startsWith("EDIÇÃO") || sheet.toUpperCase().startsWith("EDICAO");
  const rows = isEdicaoCharts
    ? await googleSheetsService.edicaoCharts.readValues(sheet, `A${de}:R${ate}`)
    : await googleSheetsService.principal.readValues(sheet, `A${de}:Z${ate}`);

  return jsonResponse({
    success: true,
    sheet,
    de,
    ate,
    linhas: rows.map((row, i) => ({ linha: de + i, valores: row })),
  });
}

export async function apagarFaixaDuplicadaLegadoController(request: Request): Promise<Response> {
  // GET com querystring (pra dar pra abrir a URL direto no navegador, sem
  // precisar de um jeito de mandar POST) ou POST com JSON — mesmo efeito.
  const url = new URL(request.url);
  const body =
    request.method === "GET"
      ? {
          linha: url.searchParams.get("linha"),
          tituloEsperado: url.searchParams.get("tituloEsperado"),
          sheet: url.searchParams.get("sheet"),
        }
      : ((await request.json().catch(() => ({}))) as {
          linha?: number | string | null;
          tituloEsperado?: string | null;
          sheet?: string | null;
        });
  const linha = Number(body.linha);
  const tituloEsperado = normalizeText(body.tituloEsperado || "");
  const sheet = normalizeText(body.sheet || "Musicas");
  if (!linha || linha < 2 || !tituloEsperado) {
    return jsonResponse({ success: false, error: "Parâmetros 'linha' e 'tituloEsperado' são obrigatórios." }, 400);
  }

  if (normalizeComparison(sheet) === normalizeComparison("EdicaoCharts")) {
    const rows = await googleSheetsService.edicaoCharts.readValues("EDIÇÃO CHARTS", `A${linha}:F${linha}`);
    const row = rows?.[0];
    if (!row) return jsonResponse({ success: false, error: "Linha não encontrada." }, 404);
    const titulo = normalizeText(row[1]); // B
    if (normalizeComparison(titulo) !== normalizeComparison(tituloEsperado)) {
      return jsonResponse(
        { success: false, error: "Título da linha não bate com o esperado — abortado por segurança.", titulo },
        409,
      );
    }
    await googleSheetsService.edicaoCharts.updateValues("EDIÇÃO CHARTS", `A${linha}:Q${linha}`, [Array(17).fill("")]);
    return jsonResponse({ success: true, sheet: "EdicaoCharts", linha, tituloApagado: titulo });
  }

  const rows = await googleSheetsService.principal.readValues("Musicas", `A${linha}:Y${linha}`);
  const row = rows?.[0];
  if (!row) return jsonResponse({ success: false, error: "Linha não encontrada." }, 404);

  const titulo = normalizeText(row[7]);
  const topicId = normalizeText(row[1]);
  const pendente = normalizeText(row[23]);

  if (normalizeComparison(titulo) !== normalizeComparison(tituloEsperado)) {
    return jsonResponse(
      { success: false, error: "Título da linha não bate com o esperado — abortado por segurança.", titulo },
      409,
    );
  }
  if (topicId) {
    return jsonResponse(
      { success: false, error: "Essa linha TEM tópico próprio (B preenchido) — não parece ser a duplicata criada pela migração. Abortado por segurança." },
      409,
    );
  }
  if (normalizeComparison(pendente) !== "sim") {
    return jsonResponse(
      { success: false, error: "Essa linha não está marcada como Pendente — não parece ser a duplicata criada pela migração. Abortado por segurança." },
      409,
    );
  }

  // Esvazia a linha inteira (não dá pra remover a linha de verdade via API
  // sem deslocar todas as de baixo) — H (título) em branco já basta pra
  // sumir de toda busca/listagem que filtra por título vazio.
  await googleSheetsService.principal.updateValues("Musicas", `A${linha}:Y${linha}`, [Array(25).fill("")]);

  return jsonResponse({ success: true, sheet: "Musicas", linha, tituloApagado: titulo });
}

// Diagnóstico cirúrgico: devolve o conteúdo bruto (sem normalizar) de uma
// linha específica de "EDIÇÃO CHARTS", pra comparar byte a byte com o
// título que o reparo espera — usado quando o reparo diz "sem pendências"
// mas uma linha continua visivelmente errada, pra achar a causa exata em
// vez de rodar reparo no escuro de novo.
export async function debugLinhaEdicaoChartsController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const linha = Number(url.searchParams.get("linha"));
  if (!linha || linha < 2) return jsonResponse({ success: false, error: "Parâmetro 'linha' obrigatório." }, 400);

  const rows = await googleSheetsService.edicaoCharts.readValues("EDIÇÃO CHARTS", `A${linha}:Q${linha}`);
  const row = rows?.[0] || [];
  return jsonResponse({
    success: true,
    linha,
    A_data: row[0] ?? null,
    B_titulo: row[1] ?? null,
    E_album: row[4] ?? null,
    E_album_length: (row[4] || "").length,
    E_album_charCodes: Array.from(String(row[4] || "")).map((ch) => ch.charCodeAt(0)),
    F_weeks: row[5] ?? null,
  });
}

// Conserto pontual: repara data e WEEKS de álbuns legados que já subiram
// ERRADOS (data de hoje em vez da data do legado, WEEKS "1" em vez do
// número de semanas retroativo) — resultado de completarAlbumExistente
// ainda não aceitar essas duas coisas quando essas migrações rodaram.
// Corrige, pra cada álbum legado: Albuns!A, EDIÇÃO CHARTS ÁLBUMS!B e C,
// e A/L de cada faixa em Musicas + A/F de cada faixa em EDIÇÃO CHARTS
// (casando pelo nome do álbum). Só escreve o que estiver diferente do
// valor esperado — já certo fica intocado, então é seguro rodar de novo.
// Processa em lote (?limit=N, padrão 5 álbuns por chamada) pelo mesmo
// motivo da migração: evitar estourar o tempo de execução do Workers.
export async function repararDatasLegadosController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const limite = Math.max(1, Math.min(15, Number(url.searchParams.get("limit")) || 5));

  const [albunsLegadosRows, albunsAtuaisRows, edicaoChartsAlbunsRows, musicasRows, edicaoChartsRows] = await Promise.all([
    readAlbunsAntigosRows(),
    googleSheetsService.principal.readValues("Albuns"),
    googleSheetsService.edicaoCharts.readValues("EDIÇÃO CHARTS ÁLBUMS"),
    googleSheetsService.principal.readValues("Musicas"),
    googleSheetsService.edicaoCharts.readValues("EDIÇÃO CHARTS"),
  ]);

  const candidatos = albunsLegadosRows
    .map((row) => {
      const artista = normalizeText(row[1]);
      const titulo = normalizeText(row[2]);
      const data = normalizeText(row[4]);
      if (!artista || !titulo || !/^\d{4}-\d{2}-\d{2}$/.test(data)) return null;
      const [ano, mes, dia] = data.split("-");
      return {
        fullTitle: `${artista} - ${titulo}`,
        dataFormatadaCorreta: `${dia}/${mes}/${ano}`,
        semanasCorretas: String(calcularSemanasRetroativas(data)),
      };
    })
    .filter((c): c is NonNullable<typeof c> => !!c);

  // Percorre TODOS os candidatos em ordem, mas só "gasta" o limite da
  // chamada em quem realmente precisava de alguma correção — sem isso,
  // um corte por posição (candidatos.slice(0, limite)) reprocessava pra
  // sempre os mesmos primeiros N álbuns (já corrigidos, virando no-op) e
  // nunca chegava nos de trás na lista, mesmo chamando o endpoint dezenas
  // de vezes.
  const resultados: { titulo: string; correcoes: string[] }[] = [];
  let candidatosVarridos = 0;

  for (const c of candidatos) {
    if (resultados.length >= limite) break;
    candidatosVarridos++;
    const key = normalizeComparison(c.fullTitle);
    const correcoes: string[] = [];

    // Albuns!A (Data de lançamento)
    const albumRowIdx = albunsAtuaisRows.findIndex((r, i) => i > 0 && normalizeComparison(normalizeText(r[6])) === key);
    if (albumRowIdx > 0) {
      const linha = albumRowIdx + 1;
      const dataAtual = normalizeText(albunsAtuaisRows[albumRowIdx][0]);
      if (dataAtual !== c.dataFormatadaCorreta) {
        await googleSheetsService.principal.updateValues("Albuns", `A${linha}`, [[c.dataFormatadaCorreta]]);
        correcoes.push(`Albuns!A${linha}: "${dataAtual}" -> "${c.dataFormatadaCorreta}"`);
      }
    }

    // EDIÇÃO CHARTS ÁLBUMS!B (Data) e C (Semanas)
    const edAlbumRowIdx = edicaoChartsAlbunsRows.findIndex(
      (r, i) => i > 0 && normalizeComparison(normalizeText(r[3])) === key,
    );
    if (edAlbumRowIdx > 0) {
      const linha = edAlbumRowIdx + 1;
      const row = edicaoChartsAlbunsRows[edAlbumRowIdx];
      const dataAtual = normalizeText(row[1]);
      const semanasAtuais = normalizeText(row[2]);
      if (dataAtual !== c.dataFormatadaCorreta) {
        await googleSheetsService.edicaoCharts.updateValues("EDIÇÃO CHARTS ÁLBUMS", `B${linha}`, [[c.dataFormatadaCorreta]]);
        correcoes.push(`EDIÇÃO CHARTS ÁLBUMS!B${linha}: "${dataAtual}" -> "${c.dataFormatadaCorreta}"`);
      }
      if (semanasAtuais !== c.semanasCorretas) {
        await googleSheetsService.edicaoCharts.updateValues("EDIÇÃO CHARTS ÁLBUMS", `C${linha}`, [[c.semanasCorretas]]);
        correcoes.push(`EDIÇÃO CHARTS ÁLBUMS!C${linha}: "${semanasAtuais}" -> "${c.semanasCorretas}"`);
      }
    }

    // Musicas!A (Data) e L (WEEKS) de toda faixa vinculada a esse álbum (K)
    for (let i = 1; i < musicasRows.length; i++) {
      const row = musicasRows[i];
      if (normalizeComparison(normalizeText(row[10])) !== key) continue;
      const linha = i + 1;
      const dataAtual = normalizeText(row[0]);
      const weeksAtual = normalizeText(row[11]);
      if (dataAtual !== c.dataFormatadaCorreta) {
        await googleSheetsService.principal.updateValues("Musicas", `A${linha}`, [[c.dataFormatadaCorreta]]);
        correcoes.push(`Musicas!A${linha}: "${dataAtual}" -> "${c.dataFormatadaCorreta}"`);
      }
      if (weeksAtual !== c.semanasCorretas) {
        await googleSheetsService.principal.updateValues("Musicas", `L${linha}`, [[c.semanasCorretas]]);
        correcoes.push(`Musicas!L${linha}: "${weeksAtual}" -> "${c.semanasCorretas}"`);
      }
    }

    // EDIÇÃO CHARTS!A (Data) e F (WEEKS) de toda faixa vinculada a esse álbum (E)
    for (let i = 1; i < edicaoChartsRows.length; i++) {
      const row = edicaoChartsRows[i];
      if (normalizeComparison(normalizeText(row[4])) !== key) continue;
      const linha = i + 1;
      const dataAtual = normalizeText(row[0]);
      const weeksAtual = normalizeText(row[5]);
      if (dataAtual !== c.dataFormatadaCorreta) {
        await googleSheetsService.edicaoCharts.updateValues("EDIÇÃO CHARTS", `A${linha}`, [[c.dataFormatadaCorreta]]);
        correcoes.push(`EDIÇÃO CHARTS!A${linha}: "${dataAtual}" -> "${c.dataFormatadaCorreta}"`);
      }
      if (weeksAtual !== c.semanasCorretas) {
        await googleSheetsService.edicaoCharts.updateValues("EDIÇÃO CHARTS", `F${linha}`, [[c.semanasCorretas]]);
        correcoes.push(`EDIÇÃO CHARTS!F${linha}: "${weeksAtual}" -> "${c.semanasCorretas}"`);
      }
    }

    if (correcoes.length > 0) {
      resultados.push({ titulo: c.fullTitle, correcoes });
    }
  }

  // "Sem mais nada a fazer" só quando varreu a lista inteira sem achar mais
  // ninguém precisando de correção — enquanto sobrar candidato não
  // verificado ainda (mesmo que os próximos N sejam todos no-op), chamar
  // de novo pode achar mais alguém pendente mais à frente na lista.
  const restantes = candidatos.length - candidatosVarridos;
  return jsonResponse({
    success: true,
    limite,
    totalAlbunsLegados: candidatos.length,
    candidatosVarridosNestaChamada: candidatosVarridos,
    albunsComCorrecao: resultados.length,
    totalCorrecoes: resultados.reduce((acc, r) => acc + r.correcoes.length, 0),
    restantes,
    mensagem:
      restantes > 0
        ? `Verificados ${candidatosVarridos} álbum(ns) nessa chamada, ${resultados.length} tinham algo pra corrigir. Ainda restam ${restantes} pra verificar — chame de novo.`
        : "Todos os álbuns legados foram verificados, nenhuma correção pendente!",
    resultados,
  });
}

// Migração pontual: os álbuns legados (Playlists_Albuns/Playlists_Faixas,
// cadastro manual sem tópico/chart) viram álbuns retroativos de verdade —
// mesmo fluxo de publicarAlbum usado por "Postar álbum retroativo" em
// Gestão, com a data original do álbum legado como data de lançamento
// (então entram nos charts já na semana certa) e toda faixa como pendente.
// Idempotente por título: pula qualquer álbum legado cujo "Artista -
// Título" já exista em Albuns (permite rodar de novo com segurança se
// algum tiver falhado no meio).
//
// Processa em LOTE (?limit=N na querystring, padrão 3) — cada álbum exige
// várias escritas sequenciais na planilha (Albuns + EDIÇÃO CHARTS ÁLBUNS +
// 1 escrita por faixa), então migrar tudo de uma vez numa única requisição
// estourava o limite de CPU do Cloudflare Workers e travava sem resposta.
// A resposta sempre diz quantos ainda faltam (`restantes`) — chame de novo
// com o mesmo limite até "restantes" chegar a 0.
// Orçamento de faixas por chamada — um álbum legado grande sozinho (ex:
// "Teoric Foundation", 14 faixas) já estourava o limite de CPU do Workers
// no meio da própria criação, deixando o álbum "pela metade" sem nenhum
// erro visível (a resposta simplesmente nunca chegava). `limit` (álbuns)
// sozinho não protegia contra isso; agora corta também por total de
// faixas processadas na chamada, faixa órfã fica pro próximo ciclo.
const MAX_FAIXAS_POR_CHAMADA = 6;

export async function migrarAlbunsLegadosController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const limite = Math.max(1, Math.min(10, Number(url.searchParams.get("limit")) || 3));

  const [albunsRows, faixasRows, albunsExistentesRows, musicasExistentesRows, edicaoChartsRows, edicaoChartsAlbunsRows] =
    await Promise.all([
      readAlbunsAntigosRows(),
      readFaixasAntigasRows(),
      googleSheetsService.principal.readValues("Albuns").catch(() => []),
      googleSheetsService.principal.readValues("Musicas").catch(() => []),
      googleSheetsService.edicaoCharts.readValues("EDIÇÃO CHARTS", "A2:B20000").catch(() => []),
      googleSheetsService.edicaoCharts.readValues("EDIÇÃO CHARTS ÁLBUMS", "A2:D20000").catch(() => []),
    ]);

  // G - Novo Nome -> {B - ID do tópico, linha}, pra conseguir completar um
  // álbum que já existe (em vez de tentar criar de novo e ser barrado pela
  // checagem de duplicidade de título) e, se for o caso, também gravar a
  // entrada que faltou em EDIÇÃO CHARTS ÁLBUMS sem duplicar a de Albuns.
  const albunsExistentesPorTitulo = new Map<string, { topicId: string; linhaEmAlbuns: number }>();
  for (let i = 0; i < (albunsExistentesRows || []).length - 1; i++) {
    const r = albunsExistentesRows[i + 1];
    const titulo = normalizeComparison(normalizeText(r[6]));
    const topicId = normalizeText(r[1]);
    if (titulo && topicId) albunsExistentesPorTitulo.set(titulo, { topicId, linhaEmAlbuns: i + 2 });
  }
  // Toda faixa já cadastrada em Musicas (H) OU já com entrada em EDIÇÃO
  // CHARTS (B) — tópico próprio já lançado, com ou sem tópico aberto, não
  // importa: já existe de verdade e conta pra chart. Checar só Musicas não
  // bastava: uma migração antiga podia ter gravado a linha em EDIÇÃO
  // CHARTS e travado antes de gravar em Musicas (ou vice-versa), e sem
  // checar as duas a faixa era duplicada na que ainda estava faltando.
  const musicasExistentesPorTituloCompleto = new Set(
    (musicasExistentesRows || []).slice(1).map((r) => normalizeComparison(normalizeText(r[7]))), // H
  );
  const edicaoChartsExistentesPorTitulo = new Set(
    (edicaoChartsRows || []).map((r) => normalizeComparison(normalizeText(r[1]))), // B
  );
  // D - Nome do álbum em EDIÇÃO CHARTS ÁLBUMS — pra saber quais álbuns já
  // existem em "Albuns" mas ficaram sem entrada aqui (escrita que falhou
  // ou foi cortada numa migração anterior).
  const albunsComEntradaEmEdicaoCharts = new Set(
    (edicaoChartsAlbunsRows || []).map((r) => normalizeComparison(normalizeText(r[3]))), // D
  );

  // Pendente aqui não é só "álbum não existe ainda" — é "tem pelo menos 1
  // faixa que ainda não está registrada" OU "o álbum em si não tem entrada
  // em EDIÇÃO CHARTS ÁLBUMS", seja porque nunca foi criado, seja porque
  // ficou incompleto numa migração anterior.
  type Pendente = {
    row: string[];
    fullTitle: string;
    todasFaixas: ReturnType<typeof faixaAntigaFromRow>[];
    faixasNovas: ReturnType<typeof faixaAntigaFromRow>[];
    albumExistente: { topicId: string; linhaEmAlbuns: number } | undefined;
    faltaEntradaEmEdicaoChartsAlbuns: boolean;
  };
  const pendentes: Pendente[] = [];
  for (const row of albunsRows) {
    const artista = normalizeText(row[1]);
    const titulo = normalizeText(row[2]);
    if (!artista || !titulo) continue;
    const fullTitle = `${artista} - ${titulo}`;
    const albumId = normalizeText(row[0]);
    const todasFaixas = faixasRows.filter((r) => normalizeText(r[0]) === albumId).map(faixaAntigaFromRow);
    if (todasFaixas.length === 0) continue;
    const faixasNovas = todasFaixas.filter((f) => {
      const tituloCompleto = normalizeComparison(tituloCompletoDaFaixa(f.titulo, artista));
      return (
        !musicasExistentesPorTituloCompleto.has(tituloCompleto) &&
        !edicaoChartsExistentesPorTitulo.has(tituloCompleto)
      );
    });
    const albumExistente = albunsExistentesPorTitulo.get(normalizeComparison(fullTitle));
    const faltaEntradaEmEdicaoChartsAlbuns =
      !!albumExistente && !albunsComEntradaEmEdicaoCharts.has(normalizeComparison(fullTitle));
    if (faixasNovas.length === 0 && !faltaEntradaEmEdicaoChartsAlbuns) continue;
    pendentes.push({
      row,
      fullTitle,
      todasFaixas,
      faixasNovas,
      albumExistente,
      faltaEntradaEmEdicaoChartsAlbuns,
    });
  }

  const resultados: { titulo: string; status: "migrado" | "completado" | "erro"; detalhe?: string }[] = [];
  let faixasProcessadasNestaChamada = 0;
  let albunsProcessados = 0;
  // Bug real corrigido aqui: antes, "restantes" contava um álbum como
  // resolvido assim que o loop TOCAVA nele (albunsProcessados++), mesmo
  // quando o orçamento de faixas da chamada (MAX_FAIXAS_POR_CHAMADA) cortou
  // no meio e só uma fração das faixas novas entrou (faltouEspaco=true).
  // Se essa fosse a última iteração da chamada com restantes calculado em
  // 0, o workflow parava de chamar de novo achando que tinha terminado —
  // foi exatamente o que aconteceu com "The Dutchess - Les Lumières"
  // (10 faixas na fonte, só 1 chegou a entrar). Agora um álbum só conta
  // como processado de verdade quando TODAS as faixas novas dele couberam
  // no orçamento da chamada.
  let albunsIncompletos = 0;

  for (const pendente of pendentes) {
    if (albunsProcessados + albunsIncompletos >= limite || faixasProcessadasNestaChamada >= MAX_FAIXAS_POR_CHAMADA) break;

    const artista = normalizeText(pendente.row[1]);
    const titulo = normalizeText(pendente.row[2]);
    const data = normalizeText(pendente.row[4]);
    const capaUrl = normalizeText(pendente.row[6]);
    const contracapaUrl = normalizeText(pendente.row[7]);
    const telegramId = normalizeText(pendente.row[9]);
    const dataLancamento = /^\d{4}-\d{2}-\d{2}$/.test(data) ? data : "";
    const numeroSemanas = dataLancamento ? calcularSemanasRetroativas(dataLancamento) : 1;

    const espacoRestante = MAX_FAIXAS_POR_CHAMADA - faixasProcessadasNestaChamada;
    const faixasDaVez = pendente.faixasNovas.slice(0, espacoRestante);
    const faltouEspaco = faixasDaVez.length < pendente.faixasNovas.length;
    const faixasJaExistiam = pendente.todasFaixas.length - pendente.faixasNovas.length;

    const nomeJogador = await resolveNomeOficial(telegramId, artista);

    try {
      if (pendente.albumExistente) {
        // Álbum já existe (migrado antes, incompleto) — só completa com as
        // faixas que ainda faltam, sem duplicar o registro do álbum. Usa a
        // MESMA data/semanas do álbum legado, não hoje.
        const detalhes: string[] = [];
        if (pendente.faltaEntradaEmEdicaoChartsAlbuns) {
          const codigo = await registrarAlbumNaEdicaoChartsAlbuns({
            artistaAlbum: artista,
            albumFullTitle: pendente.fullTitle,
            tipoAlbum: "Álbum",
            dataFormatada: dataLancamento
              ? (() => {
                  const [ano, mes, dia] = dataLancamento.split("-");
                  return `${dia}/${mes}/${ano}`;
                })()
              : new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }),
            numeroSemanas,
            numeroFaixas: pendente.todasFaixas.length,
            albumRowIndexEmAlbuns: pendente.albumExistente.linhaEmAlbuns,
          });
          detalhes.push(codigo ? "entrada em EDIÇÃO CHARTS ÁLBUMS criada (estava faltando)" : "falhou ao criar entrada em EDIÇÃO CHARTS ÁLBUMS");
        }
        if (faixasDaVez.length > 0) {
          await completarAlbumExistente({
            albumTopicId: pendente.albumExistente.topicId,
            nomeJogador,
            jogadorId: telegramId,
            dataLancamento,
            weeksOverride: String(numeroSemanas),
            novasFaixas: faixasDaVez.map((f) => ({
              num: f.numero,
              inedita: true,
              titulo: f.titulo,
              tipoSingle: "TRACKLIST ALBUM",
              tipoMusica: "SOLO",
              mediaUrl: f.drive_url,
              letra: f.letra,
              abrirTopico: false,
            })),
          });
          detalhes.push(
            `${faixasDaVez.length} faixa(s) que faltavam foram adicionadas${
              faltouEspaco ? ` (ainda faltam ${pendente.faixasNovas.length - faixasDaVez.length}, próxima chamada)` : ""
            }`,
          );
        }
        resultados.push({ titulo: pendente.fullTitle, status: "completado", detalhe: detalhes.join("; ") || undefined });
      } else {
        const payload: CreateAlbumPayload = {
          tituloAlbum: titulo,
          artistaAlbum: artista,
          tipoAlbum: "Álbum",
          capaUrl,
          encartesUrls: contracapaUrl ? [contracapaUrl] : [],
          nomeJogador,
          jogadorId: telegramId,
          dataLancamento,
          faixas: faixasDaVez.map((f) => ({
            num: f.numero,
            inedita: true,
            titulo: f.titulo,
            tipoSingle: "TRACKLIST ALBUM",
            tipoMusica: "SOLO",
            mediaUrl: f.drive_url,
            letra: f.letra,
            abrirTopico: false,
          })),
        };
        await publicarAlbum(payload);
        resultados.push({
          titulo: pendente.fullTitle,
          status: "migrado",
          detalhe: [
            faixasJaExistiam > 0 ? `${faixasJaExistiam} faixa(s) já existiam e foram puladas` : "",
            faltouEspaco
              ? `só ${faixasDaVez.length} de ${pendente.faixasNovas.length} faixas novas entraram — chame de novo pra completar`
              : "",
          ]
            .filter(Boolean)
            .join("; ") || undefined,
        });
      }
    } catch (err: any) {
      resultados.push({ titulo: pendente.fullTitle, status: "erro", detalhe: err?.message || String(err) });
    }

    faixasProcessadasNestaChamada += faixasDaVez.length;
    if (faltouEspaco) {
      albunsIncompletos++;
    } else {
      albunsProcessados++;
    }
  }

  // Só álbum TOTALMENTE processado (todas as faixas novas couberam no
  // orçamento) sai da conta — um incompleto continua contando como
  // restante, pra próxima chamada tentar completar ele de novo.
  const restantes = pendentes.length - albunsProcessados;
  return jsonResponse({
    success: true,
    limite,
    maxFaixasPorChamada: MAX_FAIXAS_POR_CHAMADA,
    totalPendentesAntes: pendentes.length,
    processadosAgora: resultados.length,
    migrados: resultados.filter((r) => r.status === "migrado").length,
    completados: resultados.filter((r) => r.status === "completado").length,
    erros: resultados.filter((r) => r.status === "erro").length,
    restantes,
    mensagem:
      restantes > 0
        ? `Faltam ${restantes} álbum(ns) (ou faixas dentro deles) — chame o mesmo endpoint de novo pra continuar.`
        : "Todos os álbuns legados pendentes foram migrados/completados!",
    resultados,
  });
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
  const linhaAlbum = await proximaLinhaLivre(SHEET_ALBUNS, "A");
  await googleSheetsService.usuarios.updateValues(SHEET_ALBUNS, `A${linhaAlbum}:K${linhaAlbum}`, [
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
  ]);

  // Isolamento por faixa: uma falha no meio da lista não pode travar as
  // faixas seguintes nem fazer o álbum voltar "ok:true" fingindo que todas
  // as faixas foram gravadas quando só uma parte foi de verdade. A linha
  // alvo é calculada uma vez e incrementada localmente — computar de novo
  // pra cada faixa reabriria a mesma corrida que causa o desvio de coluna.
  let proximaLinhaFaixa = await proximaLinhaLivre(SHEET_FAIXAS, "A");
  let faixasGravadas = 0;
  for (const f of body.faixas) {
    try {
      await googleSheetsService.usuarios.updateValues(SHEET_FAIXAS, `A${proximaLinhaFaixa}:G${proximaLinhaFaixa}`, [
        [
          albumId,
          String(f.numero || ""),
          f.titulo.trim(),
          f.artistas?.trim() || body.artista.trim(),
          f.duracao || "",
          f.drive_url.trim(),
          f.letra || "",
        ],
      ]);
      proximaLinhaFaixa++;
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

  // Nunca :append aqui (ver proximaLinhaLivre) — calcula a linha alvo a
  // partir do que já foi lido acima, tratando como "em branco" as linhas
  // deste álbum que acabaram de ser limpas.
  let ultimaComConteudo = 1;
  for (let i = 1; i < faixasRows.length; i++) {
    if (normalizeText(faixasRows[i][0]) !== id && (faixasRows[i][0] || "").toString().trim()) {
      ultimaComConteudo = i + 1;
    }
  }
  let proximaLinhaFaixa = ultimaComConteudo + 1;
  for (const f of body.faixas) {
    await googleSheetsService.usuarios.updateValues(SHEET_FAIXAS, `A${proximaLinhaFaixa}:G${proximaLinhaFaixa}`, [
      [
        id,
        String(f.numero || ""),
        f.titulo.trim(),
        f.artistas?.trim() || body.artista.trim(),
        f.duracao || "",
        f.drive_url.trim(),
        f.letra || "",
      ],
    ]);
    proximaLinhaFaixa++;
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

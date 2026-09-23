import { googleSheetsService, normalizeText, normalizeComparison, dedupeHeaders, normalizeHeader } from "../services/googleSheetsService";
import { ADMIN_TG_ID, requestProvesAdmin } from "../services/sessionService";
import { publicarAlbum, completarAlbumExistente, dedupeArtistPrefix, type CreateAlbumPayload } from "./gestaoController";

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

// Diagnóstico pontual: acha faixas duplicadas em "Musicas" (mesmo título
// completo aparecendo em mais de 1 linha) causadas pela migração de álbuns
// legados ter rodado ANTES da checagem de duplicidade existir — cada
// duplicata lista as duas linhas (a original, publicada de verdade, e a
// que a migração criou por cima) pra decidir manualmente qual apagar.
// Só lê, não apaga nada sozinho — apagar errado é mais perigoso que
// deixar a duplicata até alguém confirmar qual linha é a sobra.
export async function diagnosticoDuplicatasLegadosController(): Promise<Response> {
  const [albunsLegadosRows, faixasLegadasRows, musicasRows] = await Promise.all([
    readAlbunsAntigosRows(),
    readFaixasAntigasRows(),
    googleSheetsService.principal.readValues("Musicas"),
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

  const duplicatas: {
    titulo: string;
    ocorrencias: { linha: number; topicId: string; pendente: string; album: string }[];
  }[] = [];

  for (const row of albunsLegadosRows) {
    const artista = normalizeText(row[1]);
    const albumId = normalizeText(row[0]);
    if (!artista) continue;
    const faixas = faixasLegadasRows.filter((r) => normalizeText(r[0]) === albumId).map(faixaAntigaFromRow);
    for (const f of faixas) {
      const tituloCompleto = tituloCompletoDaFaixa(f.titulo, artista);
      const ocorrencias = musicasPorTitulo.get(normalizeComparison(tituloCompleto));
      if (ocorrencias && ocorrencias.length > 1) {
        // Evita listar o mesmo título 2x se 2 álbuns legados diferentes
        // (raro, mas possível) apontarem pra faixa igual.
        if (!duplicatas.some((d) => normalizeComparison(d.titulo) === normalizeComparison(tituloCompleto))) {
          duplicatas.push({ titulo: tituloCompleto, ocorrencias });
        }
      }
    }
  }

  return jsonResponse({
    success: true,
    totalDuplicatas: duplicatas.length,
    comoLer:
      "Pra cada título, 'ocorrencias' lista as linhas em Musicas que têm exatamente esse título. A linha com topicId preenchido (número, não vazio) é a original de verdade — geralmente a outra (pendente:'Sim', topicId vazio, album igual ao título do álbum legado) foi criada pela migração e pode ser apagada.",
    duplicatas,
  });
}

// Apaga (esvazia) a linha estranha de uma faixa duplicada em "Musicas" —
// usado depois de conferir o diagnóstico acima. Só apaga se a linha bater
// EXATAMENTE com o perfil de "criada pela migração por engano": título
// igual ao esperado, sem tópico próprio (B vazio) e Pendente = "Sim" — uma
// faixa publicada de verdade (com tópico) NUNCA é apagada por esse
// endpoint, mesmo que o título bata, por segurança.
export async function apagarFaixaDuplicadaLegadoController(request: Request): Promise<Response> {
  // GET com querystring (pra dar pra abrir a URL direto no navegador, sem
  // precisar de um jeito de mandar POST) ou POST com JSON — mesmo efeito.
  const url = new URL(request.url);
  const body =
    request.method === "GET"
      ? { linha: url.searchParams.get("linha"), tituloEsperado: url.searchParams.get("tituloEsperado") }
      : ((await request.json().catch(() => ({}))) as { linha?: number | string | null; tituloEsperado?: string | null });
  const linha = Number(body.linha);
  const tituloEsperado = normalizeText(body.tituloEsperado || "");
  if (!linha || linha < 2 || !tituloEsperado) {
    return jsonResponse({ success: false, error: "Parâmetros 'linha' e 'tituloEsperado' são obrigatórios." }, 400);
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

  return jsonResponse({ success: true, linha, tituloApagado: titulo });
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

  const [albunsRows, faixasRows, albunsExistentesRows, musicasExistentesRows] = await Promise.all([
    readAlbunsAntigosRows(),
    readFaixasAntigasRows(),
    googleSheetsService.principal.readValues("Albuns").catch(() => []),
    googleSheetsService.principal.readValues("Musicas").catch(() => []),
  ]);

  // G - Novo Nome -> B - ID do tópico, pra conseguir completar um álbum
  // que já existe (em vez de tentar criar de novo e ser barrado pela
  // checagem de duplicidade de título).
  const albunsExistentesPorTitulo = new Map<string, string>();
  for (const r of (albunsExistentesRows || []).slice(1)) {
    const titulo = normalizeComparison(normalizeText(r[6]));
    const topicId = normalizeText(r[1]);
    if (titulo && topicId) albunsExistentesPorTitulo.set(titulo, topicId);
  }
  // Toda faixa já cadastrada em Musicas (H) — tópico próprio já lançado,
  // com ou sem tópico aberto, não importa: já existe de verdade e conta
  // pra chart. Sem essa checagem, migrar um álbum legado cuja faixa já
  // tinha sido lançada avulsa (ou já migrada antes) duplicava a faixa e a
  // entrada nos charts. Comparação por título completo (H) inteiro.
  const musicasExistentesPorTituloCompleto = new Set(
    (musicasExistentesRows || []).slice(1).map((r) => normalizeComparison(normalizeText(r[7]))), // H
  );

  // Pendente aqui não é "álbum não existe ainda" — é "tem pelo menos 1
  // faixa que ainda não está em Musicas", seja porque o álbum nunca foi
  // criado, seja porque foi criado incompleto numa migração anterior.
  type Pendente = {
    row: string[];
    fullTitle: string;
    todasFaixas: ReturnType<typeof faixaAntigaFromRow>[];
    faixasNovas: ReturnType<typeof faixaAntigaFromRow>[];
    albumExistenteTopicId: string | undefined;
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
    const faixasNovas = todasFaixas.filter(
      (f) => !musicasExistentesPorTituloCompleto.has(normalizeComparison(tituloCompletoDaFaixa(f.titulo, artista))),
    );
    if (faixasNovas.length === 0) continue;
    pendentes.push({
      row,
      fullTitle,
      todasFaixas,
      faixasNovas,
      albumExistenteTopicId: albunsExistentesPorTitulo.get(normalizeComparison(fullTitle)),
    });
  }

  const resultados: { titulo: string; status: "migrado" | "completado" | "erro"; detalhe?: string }[] = [];
  let faixasProcessadasNestaChamada = 0;
  let albunsProcessados = 0;

  for (const pendente of pendentes) {
    if (albunsProcessados >= limite || faixasProcessadasNestaChamada >= MAX_FAIXAS_POR_CHAMADA) break;

    const artista = normalizeText(pendente.row[1]);
    const titulo = normalizeText(pendente.row[2]);
    const data = normalizeText(pendente.row[4]);
    const capaUrl = normalizeText(pendente.row[6]);
    const contracapaUrl = normalizeText(pendente.row[7]);
    const telegramId = normalizeText(pendente.row[9]);

    const espacoRestante = MAX_FAIXAS_POR_CHAMADA - faixasProcessadasNestaChamada;
    const faixasDaVez = pendente.faixasNovas.slice(0, espacoRestante);
    const faltouEspaco = faixasDaVez.length < pendente.faixasNovas.length;
    const faixasJaExistiam = pendente.todasFaixas.length - pendente.faixasNovas.length;

    const nomeJogador = await resolveNomeOficial(telegramId, artista);

    try {
      if (pendente.albumExistenteTopicId) {
        // Álbum já existe (migrado antes, incompleto) — só completa com as
        // faixas que ainda faltam, sem duplicar o registro do álbum.
        await completarAlbumExistente({
          albumTopicId: pendente.albumExistenteTopicId,
          nomeJogador,
          jogadorId: telegramId,
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
        resultados.push({
          titulo: pendente.fullTitle,
          status: "completado",
          detalhe: `${faixasDaVez.length} faixa(s) que faltavam foram adicionadas${
            faltouEspaco ? ` (ainda faltam ${pendente.faixasNovas.length - faixasDaVez.length}, próxima chamada)` : ""
          }`,
        });
      } else {
        const payload: CreateAlbumPayload = {
          tituloAlbum: titulo,
          artistaAlbum: artista,
          tipoAlbum: "Álbum",
          capaUrl,
          encartesUrls: contracapaUrl ? [contracapaUrl] : [],
          nomeJogador,
          jogadorId: telegramId,
          dataLancamento: /^\d{4}-\d{2}-\d{2}$/.test(data) ? data : "",
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
    albunsProcessados++;
  }

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

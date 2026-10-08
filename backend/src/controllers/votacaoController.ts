import { readValues, updateValues, appendRow, normalizeText, normalizeComparison, ensureSheetTab, googleSheetsService } from "../services/googleSheetsService";
import { colIndexToA1Letter } from "./pontoController";
import { resolveNomeOficial } from "./forumController";
import { PREMIACOES_INDICAR, parseDataBR, calcularStatus } from "./indicacoesController";
import { getCatalogoDb } from "../services/catalogoDbService";
import { buildFotoPorArtista, buildCapaPorTitulo } from "./awardsController";
import { buildCleanItem } from "./empirePlayController";

// Termo de integridade do voto — obrigatório, mostrado uma vez só por
// jogador, antes de liberar a lista de categorias (depois do gate de
// Performance). Diferente do termo de Performance (esse é condicional, só
// pra quem quer performar); este aqui é obrigatório pra TODO mundo que
// for votar, sem opção de recusar — só "Aceito". Texto fixo (não veio de
// nenhuma aba/coluna, diferente do termo de Performance).
export const TERMO_INTEGRIDADE_VOTO =
  'Estou ciente de que não devo votar em mim mesmo e nem dar notas baixas para me sobressair aos demais. Caso eu faça isso, irei perder metade das vendas do meu material mais recente - irão para uma doação anônima.';

const TERMO_VOTO_STATUS_SHEET = "Votacao_Status";

function hojeBR(): string {
  const hoje = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const dd = String(hoje.getDate()).padStart(2, "0");
  const mm = String(hoje.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${hoje.getFullYear()}`;
}

async function ensureTermoVotoSheetPronta(awardId: string): Promise<void> {
  await ensureSheetTab(awardId, TERMO_VOTO_STATUS_SHEET);
  const header = await readValues(awardId, TERMO_VOTO_STATUS_SHEET, "A1:C1").catch(() => []);
  if (!normalizeText(header?.[0]?.[0])) {
    await updateValues(awardId, TERMO_VOTO_STATUS_SHEET, "A1:C1", [["TelegramId", "Aceite", "Data"]]);
  }
}

async function jogadorAceitouTermoVoto(awardId: string, telegramId: string): Promise<boolean> {
  const rows = await readValues(awardId, TERMO_VOTO_STATUS_SHEET, "A2:C20000").catch(() => []);
  return rows.some((r) => normalizeComparison(normalizeText(r[0])) === normalizeComparison(telegramId));
}

// GET /api/premiacoes/votacao/termo-status?awardId=...&telegramId=...
export async function statusTermoVotoController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const awardId = normalizeText(url.searchParams.get("awardId"));
  const telegramId = normalizeText(url.searchParams.get("telegramId"));
  if (!awardId || !telegramId) return jsonResponse({ success: false, error: "awardId e telegramId são obrigatórios." }, 400);

  const aceito = await jogadorAceitouTermoVoto(awardId, telegramId);
  return jsonResponse({ success: true, data: { aceito, texto: TERMO_INTEGRIDADE_VOTO } });
}

// POST /api/premiacoes/votacao/termo-aceitar
// body: { awardId, telegramId }
export async function aceitarTermoVotoController(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as { awardId?: string; telegramId?: string };
  const awardId = normalizeText(body.awardId);
  const telegramId = normalizeText(body.telegramId);
  if (!awardId || !telegramId) return jsonResponse({ success: false, error: "awardId e telegramId são obrigatórios." }, 400);

  await ensureTermoVotoSheetPronta(awardId);
  const jaAceitou = await jogadorAceitouTermoVoto(awardId, telegramId);
  if (!jaAceitou) {
    await appendRow(awardId, TERMO_VOTO_STATUS_SHEET, [telegramId, "sim", hojeBR()], "A:C", "OVERWRITE");
  }
  return jsonResponse({ success: true });
}

// Mapeia o `tipo` do D1 (midia.tipo) pro nome de aba que o Fórum usa na URL
// (/empire-play/forum?tab=...&id=...) — "Visitar fórum" no card do indicado.
const TIPO_D1_PARA_TAB: Record<string, "musicas" | "videos" | "albuns"> = {
  musica: "musicas",
  video: "videos",
  album: "albuns",
};

interface MidiaResumo {
  topicId: string;
  tab: "musicas" | "videos" | "albuns";
  titulo: string;
  imagem: string;
  thumbUrl: string;
  capaUrl: string;
  videoUrl: string;
}

// Frame extraído do próprio vídeo pelo serviço de thumbnail do Google (o
// mesmo CDN que já serve as capas de imagem do app, driveImgWide em
// src/lib/api.ts) — funciona pra vídeo também, não só imagem: dado o ID do
// arquivo no Drive, devolve um frame renderizado do clipe. Só usado quando
// a mídia NÃO tem thumb/capa própria preenchida (combinado com o usuário).
// Largura grande (1000) pra sair em boa qualidade mesmo em tela de
// densidade alta.
function extrairFrameClipe(videoUrl: string, largura = 1000): string {
  const m = videoUrl.match(/[-\w]{25,}/);
  if (!m) return "";
  return `https://lh3.googleusercontent.com/d/${m[0]}=w${largura}`;
}

// Busca em lote (D1, índice em codigo_unico) TODOS os registros com aquele
// código — confirmado ao vivo: um Código único NÃO é 1:1 com um vídeo. Uma
// música pode ter vários clipes com o mesmo código (clipe oficial, versão
// acústica, apresentação ao vivo, aparição em TV...), cada um sua própria
// linha no D1, e nem todos têm thumb cadastrada. Pegar só "a primeira linha
// que achar" (como a versão anterior fazia) às vezes pegava uma versão sem
// capa enquanto outra do mesmo código tinha — não é dado faltando, é
// escolha errada entre as várias linhas candidatas.
async function buscarMidiaPorCodigosUnicos(codigos: string[]): Promise<Map<string, MidiaResumo[]>> {
  const mapa = new Map<string, MidiaResumo[]>();
  const unicos = Array.from(new Set(codigos.map((c) => normalizeText(c)).filter(Boolean)));
  if (unicos.length === 0) return mapa;
  const db = getCatalogoDb();
  if (!db) return mapa;
  try {
    const placeholders = unicos.map(() => "?").join(",");
    const result = await db
      .prepare(
        `SELECT codigo_unico, id, tipo, titulo, capa_url, thumb_url, video_url FROM midia WHERE codigo_unico IN (${placeholders})`,
      )
      .bind(...unicos)
      .all<{
        codigo_unico: string;
        id: string;
        tipo: string;
        titulo: string;
        capa_url: string | null;
        thumb_url: string | null;
        video_url: string | null;
      }>();
    for (const row of result.results) {
      const chave = normalizeComparison(row.codigo_unico);
      const lista = mapa.get(chave) || [];
      lista.push({
        topicId: row.id,
        tab: TIPO_D1_PARA_TAB[row.tipo] || "musicas",
        titulo: row.titulo,
        imagem: row.thumb_url || row.capa_url || "",
        thumbUrl: row.thumb_url || "",
        capaUrl: row.capa_url || "",
        videoUrl: row.video_url || "",
      });
      mapa.set(chave, lista);
    }
  } catch (err) {
    console.warn("[votacaoController] Falha ao buscar mídia por código único no D1:", err);
  }
  return mapa;
}

// Entre as várias linhas do D1 que compartilham o mesmo Código único, a
// ordem de retorno do banco não indica qual é "a certa" — confirmado ao
// vivo (EMP659): a linha tipo "musica" vinha primeiro e TINHA capa_url
// preenchida, mas apontando pra um arquivo já apagado do Drive (404). A
// linha tipo "video" do MESMO código tinha a thumb real na coluna Thumb
// da planilha (thumb_url). capa_url sozinho não é confiável — por isso
// a prioridade é estritamente: 1) primeira candidata com thumb_url (a
// coluna "Thumb" de verdade); 2) primeira com video_url (fallback de
// frame do clipe); 3) primeira com capa_url; 4) index 0.
function escolherMelhorCandidato(candidatos: MidiaResumo[]): MidiaResumo | undefined {
  const comThumb = candidatos.find((c) => c.thumbUrl);
  if (comThumb) return comThumb;
  const comVideo = candidatos.find((c) => c.videoUrl);
  if (comVideo) return comVideo;
  const comCapa = candidatos.find((c) => c.capaUrl);
  if (comCapa) return comCapa;
  return candidatos[0];
}

// Cache em memória (por isolate) dos fallbacks de imagem mais caros — cada
// um lê uma planilha inteira (Musicas+Albuns / Usuários+INFOS ACTS / Music
// Videos). Sem isso, trocar de categoria (até 21 numa premiação só) pagava
// essa leitura de novo toda vez, o que deixava a tela lenta. TTL curto
// (1 min) só pra não ficar servindo dado desatualizado por muito tempo se
// alguém subir uma capa nova durante a votação.
const CACHE_IMAGENS_TTL_MS = 60_000;
let capaPorTituloCache: { data: Map<string, string>; expiresAt: number } | null = null;
let fotoPorArtistaCache: { data: Map<string, string>; expiresAt: number } | null = null;
let videoPorCodigoETituloCache:
  | { data: { porCodigo: Map<string, VideoResumo>; porTitulo: Map<string, VideoResumo> }; expiresAt: number }
  | null = null;

async function getCapaPorTituloCached(): Promise<Map<string, string>> {
  if (capaPorTituloCache && capaPorTituloCache.expiresAt > Date.now()) return capaPorTituloCache.data;
  const data = await buildCapaPorTitulo().catch(() => new Map<string, string>());
  capaPorTituloCache = { data, expiresAt: Date.now() + CACHE_IMAGENS_TTL_MS };
  return data;
}

async function getFotoPorArtistaCached(): Promise<Map<string, string>> {
  if (fotoPorArtistaCache && fotoPorArtistaCache.expiresAt > Date.now()) return fotoPorArtistaCache.data;
  const data = await buildFotoPorArtista().catch(() => new Map<string, string>());
  fotoPorArtistaCache = { data, expiresAt: Date.now() + CACHE_IMAGENS_TTL_MS };
  return data;
}

interface VideoResumo {
  coverUrl: string;
  videoUrl: string;
  topicId: string;
}

// Fallback específico de VÍDEO — confirmado ao vivo pelo usuário: quando o
// D1 não tem nenhuma linha pro Código único do indicado (ex: EMP589,
// "Hasta La Vista"), o fallback por título caía em buildCapaPorTitulo, que
// só olha Musicas/Albuns — ou seja, a capa do SINGLE, não do vídeo. Pra
// categoria de vídeo isso é visivelmente errado ("tá olhando dos SINGLES").
// A aba "Music Videos" (planilha principal) é o catálogo de vídeos de
// verdade — busca primeiro por Código único, depois por título, igual o
// fallback de single já fazia, mas na aba certa.
async function buildVideoPorCodigoETitulo(): Promise<{
  porCodigo: Map<string, VideoResumo>;
  porTitulo: Map<string, VideoResumo>;
}> {
  const porCodigo = new Map<string, VideoResumo>();
  const porTitulo = new Map<string, VideoResumo>();
  const registros = await googleSheetsService.principal.readSheetObjects("Music Videos").catch(() => []);
  registros.forEach((rec, i) => {
    const item = buildCleanItem("Music Videos", rec, i);
    if (!item.coverUrl && !item.videoUrl) return;
    const resumo: VideoResumo = {
      coverUrl: item.coverUrl || "",
      videoUrl: item.videoUrl || "",
      topicId: item.id,
    };
    const codigo = normalizeComparison(rec["codigo_unico"] || "");
    if (codigo && !porCodigo.has(codigo)) porCodigo.set(codigo, resumo);
    const titulo = normalizeComparison(item.title || "");
    if (titulo && !porTitulo.has(titulo)) porTitulo.set(titulo, resumo);
  });
  return { porCodigo, porTitulo };
}

async function getVideoPorCodigoETituloCached(): Promise<{
  porCodigo: Map<string, VideoResumo>;
  porTitulo: Map<string, VideoResumo>;
}> {
  if (videoPorCodigoETituloCache && videoPorCodigoETituloCache.expiresAt > Date.now()) {
    return videoPorCodigoETituloCache.data;
  }
  const data = await buildVideoPorCodigoETitulo().catch(() => ({
    porCodigo: new Map<string, VideoResumo>(),
    porTitulo: new Map<string, VideoResumo>(),
  }));
  videoPorCodigoETituloCache = { data, expiresAt: Date.now() + CACHE_IMAGENS_TTL_MS };
  return data;
}

// Indicados de categoria ARTIST/GRUPO não têm Código único (o "material" é
// o próprio artista) — usa a foto oficial dele, mesma fonte que Retroativo
// já usa pros awards sem capa de música/álbum.
//
// Prioridade de resolução (confirmado ao vivo com o usuário, inclusive o
// caso de "Hasta La Vista" / EMP589 sem NENHUMA linha no D1): sempre
// vídeo antes de single/álbum — categoria de vídeo não pode acabar
// mostrando a capa do single só porque o D1 não tinha o código.
//   1. D1: thumb_url de verdade
//   2. D1: frame extraído do video_url
//   3. Aba "Music Videos" por Código único (capa ou frame do vídeo)
//   4. Aba "Music Videos" por título (idem)
//   5. D1: capa_url (capa do single, último recurso de "ainda é vídeo")
//   6. capaPorTitulo em Musicas/Albuns (capa do single/álbum)
//   7. foto do artista (cobre ARTIST/GRUPO, sem código único)
async function anexarImagens<T extends { titulo: string; artista: string; codigoUnico?: string }>(
  indicados: T[],
): Promise<(T & { imagem: string; topicId: string; tab: string })[]> {
  const codigos = indicados.map((i) => i.codigoUnico || "").filter(Boolean);

  const [porCodigo, videoFallback, capaPorTitulo, fotoPorArtista] = await Promise.all([
    buscarMidiaPorCodigosUnicos(codigos),
    getVideoPorCodigoETituloCached(),
    getCapaPorTituloCached(),
    getFotoPorArtistaCached(),
  ]);

  return indicados.map((ind) => {
    const candidatos = ind.codigoUnico ? porCodigo.get(normalizeComparison(ind.codigoUnico)) || [] : [];
    const melhor = escolherMelhorCandidato(candidatos);
    // thumb_url de verdade (coluna "Thumb" da planilha) sempre primeiro —
    // capa_url sozinho pode apontar pra arquivo já apagado do Drive.
    if (melhor?.thumbUrl) {
      return { ...ind, imagem: melhor.thumbUrl, topicId: melhor.topicId, tab: melhor.tab };
    }
    // Sem thumb cadastrada pra esse vídeo — extrai um frame do próprio
    // clipe (combinado com o usuário), em vez de já cair pra capa de outra
    // coisa (título/artista).
    if (melhor?.videoUrl) {
      const frame = extrairFrameClipe(melhor.videoUrl);
      if (frame) return { ...ind, imagem: frame, topicId: melhor.topicId, tab: melhor.tab };
    }
    // D1 não tem esse código (ou não tem thumb/video_url em nenhuma linha)
    // — tenta achar o VÍDEO de verdade na aba "Music Videos" antes de cair
    // pra capa de single/álbum.
    const videoPeloCodigo = ind.codigoUnico ? videoFallback.porCodigo.get(normalizeComparison(ind.codigoUnico)) : undefined;
    const videoPeloTitulo = videoFallback.porTitulo.get(normalizeComparison(ind.titulo));
    const videoAchado = videoPeloCodigo || videoPeloTitulo;
    if (videoAchado?.coverUrl) {
      return { ...ind, imagem: videoAchado.coverUrl, topicId: videoAchado.topicId, tab: "videos" };
    }
    if (videoAchado?.videoUrl) {
      const frame = extrairFrameClipe(videoAchado.videoUrl);
      if (frame) return { ...ind, imagem: frame, topicId: videoAchado.topicId, tab: "videos" };
    }
    if (melhor?.capaUrl) {
      return { ...ind, imagem: melhor.capaUrl, topicId: melhor.topicId, tab: melhor.tab };
    }
    const capaPeloTitulo = capaPorTitulo.get(normalizeComparison(ind.titulo)) || "";
    if (capaPeloTitulo) {
      return { ...ind, imagem: capaPeloTitulo, topicId: melhor?.topicId || "", tab: melhor?.tab || "" };
    }
    // Sem capa achada — tenta a foto do artista (cobre categoria
    // ARTIST/GRUPO, que nunca tem código único, e serve de último recurso
    // pros vídeos sem nenhuma imagem cadastrada em lugar nenhum).
    const nomeArtista = ind.artista || ind.titulo;
    const foto = fotoPorArtista.get(normalizeComparison(nomeArtista)) || "";
    return { ...ind, imagem: foto, topicId: melhor?.topicId || "", tab: melhor?.tab || "" };
  });
}

// "Votação" (Perfil > Premiações > Votação) — segunda fase do mesmo ciclo
// de premiação do "Indicar" (indicacoesController.ts), mesma planilha por
// premiação (ver PREMIACOES_INDICAR). A aba "Detalhes" agora tem uma linha
// por FASE (não só uma): a coluna "Calendário" diz se a linha é
// "Indicações" ou "Votação", cada uma com sua própria janela de
// Abertura/Encerramento; "Abas" diz em quais abas a fase escreve/lê —
// pra Votação, sempre as duas: "Indicações_VotoPorNota, Indicações_Voto".
//
// Cada categoria (aba "Categorias", coluna C "Tipo de categoria") é "Por
// nota" ou "Por votação" — isso decide em qual das duas abas de voto ela
// vive. Dentro de cada aba, as categorias formam BLOCOS consecutivos:
//   <linha só com o nome da categoria em caixa alta>
//   <linha de cabeçalho: MÚSICA/ÁLBUM | ARTISTA | CÓDIGO ÚNICO | <jogador 1> | <jogador 2> | ...>
//   <uma linha por indicado>
//   <linha em branco separando o próximo bloco>
// Cada jogador tem SUA PRÓPRIA COLUNA (criada na hora do primeiro voto
// dele naquela categoria) — nota (VotoPorNota) ou marca de escolha (Voto).
// Nunca lemos a coluna de outro jogador: o app não expõe nota/voto alheio
// nem resultado parcial a ninguém.
const NOTA_MIN = 5;
const NOTA_MAX = 10;
const VOTO_MIN_SELECOES = 2;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

export interface FaseVotacao {
  id: string;
  premiacao: string;
  abertura: string;
  encerramento: string;
  capaUrl: string;
  abaNota: string;
  abaVoto: string;
  status: "agendado" | "aberto" | "encerrado";
}

export async function lerFaseVotacao(awardId: string): Promise<FaseVotacao | null> {
  const rows = await readValues(awardId, "Detalhes", "A2:I200").catch(() => []);
  const row = rows.find((r) => normalizeComparison(r[7]) === "votacao");
  if (!row || !normalizeText(row[0])) return null;
  const abertura = normalizeText(row[1]);
  const encerramento = normalizeText(row[2]);
  const abas = normalizeText(row[8])
    .split(",")
    .map((a) => a.trim())
    .filter(Boolean);
  return {
    id: awardId,
    premiacao: normalizeText(row[0]),
    abertura,
    encerramento,
    capaUrl: normalizeText(row[6]),
    abaNota: abas.find((a) => normalizeComparison(a).includes("nota")) || "",
    abaVoto: abas.find((a) => a && !normalizeComparison(a).includes("nota")) || "",
    status: calcularStatus(abertura, encerramento),
  };
}

interface CategoriaVotacao {
  categoria: string;
  descritivo: string;
  tipo: "nota" | "voto";
}

async function lerCategoriasVotacao(awardId: string): Promise<CategoriaVotacao[]> {
  const rows = await readValues(awardId, "Categorias", "A2:F1000").catch(() => []);
  return rows
    .filter((r) => normalizeText(r[0]))
    .map((r) => {
      const tipoBruto = normalizeComparison(r[2]);
      const tipo: CategoriaVotacao["tipo"] = tipoBruto.includes("nota") ? "nota" : "voto";
      return { categoria: normalizeText(r[0]), descritivo: normalizeText(r[1]), tipo };
    });
}

interface IndicadoBloco {
  rowNumber: number;
  titulo: string;
  artista: string;
  codigoUnico: string;
  valores: string[]; // paralelo a bloco.colunas
}

interface BlocoVoto {
  categoria: string;
  headerRowNumber: number;
  headerLabels: [string, string, string]; // "MÚSICA"/"ÁLBUM" | "ARTISTA" | "CÓDIGO ÚNICO", como já estava na planilha
  colunas: string[]; // nomes dos jogadores, a partir da coluna D
  indicados: IndicadoBloco[];
}

// Lê a aba inteira (sem limite de range — o número de colunas cresce
// conforme mais jogadores votam) e separa em blocos por categoria.
function parseBlocos(rows: string[][]): BlocoVoto[] {
  const blocos: BlocoVoto[] = [];
  let i = 0;
  while (i < rows.length) {
    const row = rows[i] || [];
    const categoria = normalizeText(row[0]);
    const ehTituloDeCategoria = categoria && !normalizeText(row[1]) && !normalizeText(row[2]);
    if (!ehTituloDeCategoria) {
      i++;
      continue;
    }
    const headerRowNumber = i + 2; // 1-based: linha i é a de título, i+1 (0-based) é o cabeçalho
    const headerRow = rows[i + 1] || [];
    const headerLabels: [string, string, string] = [
      normalizeText(headerRow[0]) || "MÚSICA",
      normalizeText(headerRow[1]) || "ARTISTA",
      normalizeText(headerRow[2]) || "CÓDIGO ÚNICO",
    ];
    const colunas = headerRow.slice(3).map((c) => normalizeText(c));
    const indicados: IndicadoBloco[] = [];
    let j = i + 2;
    while (j < rows.length && normalizeText(rows[j]?.[0])) {
      const r = rows[j] || [];
      indicados.push({
        rowNumber: j + 1,
        titulo: normalizeText(r[0]),
        artista: normalizeText(r[1]),
        codigoUnico: normalizeText(r[2]),
        valores: colunas.map((_, idx) => normalizeText(r[3 + idx])),
      });
      j++;
    }
    blocos.push({ categoria, headerRowNumber, headerLabels, colunas, indicados });
    i = j + 1; // pula a linha em branco separadora
  }
  return blocos;
}

function acharBloco(blocos: BlocoVoto[], categoria: string): BlocoVoto | undefined {
  return blocos.find((b) => normalizeComparison(b.categoria) === normalizeComparison(categoria));
}

// Acha a coluna do jogador nesse bloco; se ele ainda não votou nessa
// categoria, cria a coluna (no fim) com uma célula vazia por indicado —
// só em memória, quem grava de fato é regravarBloco().
function acharOuCriarColuna(bloco: BlocoVoto, nomeJogador: string): number {
  const idx = bloco.colunas.findIndex((c) => normalizeComparison(c) === normalizeComparison(nomeJogador));
  if (idx >= 0) return idx;
  bloco.colunas.push(nomeJogador);
  for (const ind of bloco.indicados) ind.valores.push("");
  return bloco.colunas.length - 1;
}

// Regrava o cabeçalho (pode ter ganhado coluna nova) e as linhas de
// indicados do bloco, já na ordem dada (reordenar é o que aplica o
// ranking automático — 1º colocado na linha de cima).
async function regravarBloco(awardId: string, aba: string, bloco: BlocoVoto, ordenados: IndicadoBloco[]): Promise<void> {
  const ultimaColIdx = 3 + bloco.colunas.length - 1;
  const ultimaColLetra = colIndexToA1Letter(ultimaColIdx);

  await updateValues(awardId, aba, `A${bloco.headerRowNumber}:${ultimaColLetra}${bloco.headerRowNumber}`, [
    [...bloco.headerLabels, ...bloco.colunas],
  ]);

  const dataStart = bloco.headerRowNumber + 1;
  const dataEnd = dataStart + ordenados.length - 1;
  const matriz = ordenados.map((ind) => [ind.titulo, ind.artista, ind.codigoUnico, ...ind.valores]);
  await updateValues(awardId, aba, `A${dataStart}:${ultimaColLetra}${dataEnd}`, matriz);
}

// Nota: média das notas preenchidas (célula vazia não entra na média, já
// que dar nota não é obrigatório pra todos os indicados). Sem nenhuma nota
// ainda, fica no fim do ranking (score -1, sempre menor que qualquer nota
// válida de 5-10).
function scoreNota(valores: string[]): number {
  const nums = valores
    .map((v) => parseFloat(normalizeText(v).replace(",", ".")))
    .filter((n) => Number.isFinite(n));
  if (nums.length === 0) return -1;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

// Voto: quantidade de marcações recebidas (qualquer célula não-vazia conta).
function scoreVoto(valores: string[]): number {
  return valores.filter((v) => normalizeText(v)).length;
}

function ordenarPorScore(indicados: IndicadoBloco[], score: (valores: string[]) => number): IndicadoBloco[] {
  return [...indicados].sort((a, b) => score(b.valores) - score(a.valores));
}

// GET /api/premiacoes/votacao/awards
export async function listarPremiacoesVotacaoController(): Promise<Response> {
  const fases = await Promise.all(PREMIACOES_INDICAR.map((id) => lerFaseVotacao(id).catch(() => null)));
  return jsonResponse({ success: true, data: fases.filter((f): f is FaseVotacao => !!f) });
}

// GET /api/premiacoes/votacao/categorias?awardId=...
export async function listarCategoriasVotacaoController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const awardId = normalizeText(url.searchParams.get("awardId"));
  if (!awardId) return jsonResponse({ success: false, error: "awardId é obrigatório." }, 400);

  const [detalhes, categorias] = await Promise.all([lerFaseVotacao(awardId), lerCategoriasVotacao(awardId)]);
  if (!detalhes) return jsonResponse({ success: false, error: "Essa premiação ainda não tem fase de votação." }, 404);
  return jsonResponse({ success: true, data: { detalhes, categorias } });
}

async function carregarBlocoDaCategoria(
  awardId: string,
  detalhes: FaseVotacao,
  categoriaInfo: CategoriaVotacao,
): Promise<{ aba: string; bloco: BlocoVoto | undefined }> {
  const aba = categoriaInfo.tipo === "nota" ? detalhes.abaNota : detalhes.abaVoto;
  if (!aba) return { aba: "", bloco: undefined };
  const rows = await readValues(awardId, aba).catch(() => []);
  const blocos = parseBlocos(rows);
  return { aba, bloco: acharBloco(blocos, categoriaInfo.categoria) };
}

// GET /api/premiacoes/votacao/indicados?awardId=...&categoria=...&telegramId=...
// Devolve só os indicados + o que ESSE jogador já marcou (nunca a nota/voto
// de outro jogador, nunca o ranking).
export async function listarIndicadosVotacaoController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const awardId = normalizeText(url.searchParams.get("awardId"));
  const categoria = normalizeText(url.searchParams.get("categoria"));
  const telegramId = normalizeText(url.searchParams.get("telegramId"));
  if (!awardId || !categoria || !telegramId) {
    return jsonResponse({ success: false, error: "awardId, categoria e telegramId são obrigatórios." }, 400);
  }

  const [detalhes, categorias] = await Promise.all([lerFaseVotacao(awardId), lerCategoriasVotacao(awardId)]);
  if (!detalhes) return jsonResponse({ success: false, error: "Premiação não encontrada." }, 404);
  const categoriaInfo = categorias.find((c) => normalizeComparison(c.categoria) === normalizeComparison(categoria));
  if (!categoriaInfo) return jsonResponse({ success: false, error: "Categoria não encontrada." }, 404);

  const { bloco } = await carregarBlocoDaCategoria(awardId, detalhes, categoriaInfo);
  if (!bloco) {
    return jsonResponse({ success: true, data: { tipo: categoriaInfo.tipo, indicados: [] } });
  }

  const nomeJogador = await resolveNomeOficial(telegramId, "Jogador");
  const colIdx = bloco.colunas.findIndex((c) => normalizeComparison(c) === normalizeComparison(nomeJogador));

  const indicadosBase = bloco.indicados.map((ind) => ({
    titulo: ind.titulo,
    artista: ind.artista,
    codigoUnico: ind.codigoUnico,
    meuValor: colIdx >= 0 ? ind.valores[colIdx] || "" : "",
  }));
  const indicados = await anexarImagens(indicadosBase);

  return jsonResponse({ success: true, data: { tipo: categoriaInfo.tipo, indicados } });
}

// POST /api/premiacoes/votacao/nota
// body: { awardId, categoria, titulo, nota (string, "" limpa), telegramId }
export async function registrarNotaVotacaoController(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as {
    awardId?: string;
    categoria?: string;
    titulo?: string;
    nota?: string;
    telegramId?: string;
  };
  const awardId = normalizeText(body.awardId);
  const categoria = normalizeText(body.categoria);
  const titulo = normalizeText(body.titulo);
  const notaStr = normalizeText(body.nota).replace(",", ".");
  const telegramId = normalizeText(body.telegramId);
  if (!awardId || !categoria || !titulo || !telegramId) {
    return jsonResponse({ success: false, error: "Campos obrigatórios ausentes." }, 400);
  }

  let notaNum: number | null = null;
  if (notaStr) {
    notaNum = Number(notaStr);
    if (!Number.isFinite(notaNum) || notaNum < NOTA_MIN || notaNum > NOTA_MAX) {
      return jsonResponse({ success: false, error: `A nota precisa ser entre ${NOTA_MIN} e ${NOTA_MAX}.` }, 400);
    }
  }

  const [detalhes, categorias] = await Promise.all([lerFaseVotacao(awardId), lerCategoriasVotacao(awardId)]);
  if (!detalhes) return jsonResponse({ success: false, error: "Premiação não encontrada." }, 404);
  if (detalhes.status !== "aberto") {
    return jsonResponse({ success: false, error: "A votação não está aberta no momento." }, 403);
  }
  const categoriaInfo = categorias.find((c) => normalizeComparison(c.categoria) === normalizeComparison(categoria));
  if (!categoriaInfo || categoriaInfo.tipo !== "nota") {
    return jsonResponse({ success: false, error: "Categoria inválida pra voto por nota." }, 400);
  }

  const { aba, bloco } = await carregarBlocoDaCategoria(awardId, detalhes, categoriaInfo);
  if (!bloco) return jsonResponse({ success: false, error: "Categoria sem indicados ainda." }, 404);
  const indicado = bloco.indicados.find((i) => normalizeComparison(i.titulo) === normalizeComparison(titulo));
  if (!indicado) return jsonResponse({ success: false, error: "Indicado não encontrado." }, 404);

  const nomeJogador = await resolveNomeOficial(telegramId, "Jogador");
  const colIdx = acharOuCriarColuna(bloco, nomeJogador);
  indicado.valores[colIdx] = notaNum === null ? "" : String(notaNum);

  const ordenados = ordenarPorScore(bloco.indicados, scoreNota);
  await regravarBloco(awardId, aba, bloco, ordenados);

  return jsonResponse({ success: true });
}

// POST /api/premiacoes/votacao/voto
// body: { awardId, categoria, selecoes: string[] (títulos marcados), telegramId }
export async function registrarVotoVotacaoController(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as {
    awardId?: string;
    categoria?: string;
    selecoes?: string[];
    telegramId?: string;
  };
  const awardId = normalizeText(body.awardId);
  const categoria = normalizeText(body.categoria);
  const telegramId = normalizeText(body.telegramId);
  const selecoes = Array.isArray(body.selecoes) ? body.selecoes.map((s) => normalizeText(s)).filter(Boolean) : [];
  if (!awardId || !categoria || !telegramId) {
    return jsonResponse({ success: false, error: "Campos obrigatórios ausentes." }, 400);
  }

  const [detalhes, categorias] = await Promise.all([lerFaseVotacao(awardId), lerCategoriasVotacao(awardId)]);
  if (!detalhes) return jsonResponse({ success: false, error: "Premiação não encontrada." }, 404);
  if (detalhes.status !== "aberto") {
    return jsonResponse({ success: false, error: "A votação não está aberta no momento." }, 403);
  }
  const categoriaInfo = categorias.find((c) => normalizeComparison(c.categoria) === normalizeComparison(categoria));
  if (!categoriaInfo || categoriaInfo.tipo !== "voto") {
    return jsonResponse({ success: false, error: "Categoria inválida pra votação de múltipla escolha." }, 400);
  }

  const { aba, bloco } = await carregarBlocoDaCategoria(awardId, detalhes, categoriaInfo);
  if (!bloco) return jsonResponse({ success: false, error: "Categoria sem indicados ainda." }, 404);

  const titulosValidos = new Set(bloco.indicados.map((i) => normalizeComparison(i.titulo)));
  const selecoesValidas = selecoes.filter((s) => titulosValidos.has(normalizeComparison(s)));
  if (selecoesValidas.length < VOTO_MIN_SELECOES) {
    return jsonResponse({ success: false, error: `Escolha pelo menos ${VOTO_MIN_SELECOES} indicados.` }, 400);
  }
  if (selecoesValidas.length >= bloco.indicados.length) {
    return jsonResponse({ success: false, error: "Não dá pra votar em todos os indicados dessa categoria." }, 400);
  }

  const nomeJogador = await resolveNomeOficial(telegramId, "Jogador");
  const colIdx = acharOuCriarColuna(bloco, nomeJogador);
  const setSelecoes = new Set(selecoesValidas.map((s) => normalizeComparison(s)));
  for (const ind of bloco.indicados) {
    ind.valores[colIdx] = setSelecoes.has(normalizeComparison(ind.titulo)) ? "X" : "";
  }

  const ordenados = ordenarPorScore(bloco.indicados, scoreVoto);
  await regravarBloco(awardId, aba, bloco, ordenados);

  return jsonResponse({ success: true });
}

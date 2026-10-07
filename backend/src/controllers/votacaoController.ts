import { readValues, updateValues, normalizeText, normalizeComparison } from "../services/googleSheetsService";
import { colIndexToA1Letter } from "./pontoController";
import { resolveNomeOficial } from "./forumController";
import { PREMIACOES_INDICAR, parseDataBR, calcularStatus } from "./indicacoesController";
import { getCatalogoDb } from "../services/catalogoDbService";
import { buildFotoPorArtista } from "./awardsController";

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
  imagem: string;
}

// Busca em lote (D1, índice em codigo_unico) a imagem (thumb do vídeo, ou
// capa quando não há thumb própria) e o topicId de cada indicado — é por
// isso que o usuário colocou o Código único nas abas de voto: não precisa
// resolver título/artista ambíguo, o código já aponta direto pro registro
// certo no catálogo.
async function buscarMidiaPorCodigosUnicos(codigos: string[]): Promise<Map<string, MidiaResumo>> {
  const mapa = new Map<string, MidiaResumo>();
  const unicos = Array.from(new Set(codigos.map((c) => normalizeText(c)).filter(Boolean)));
  if (unicos.length === 0) return mapa;
  const db = getCatalogoDb();
  if (!db) return mapa;
  try {
    const placeholders = unicos.map(() => "?").join(",");
    const result = await db
      .prepare(`SELECT codigo_unico, id, tipo, capa_url, thumb_url FROM midia WHERE codigo_unico IN (${placeholders})`)
      .bind(...unicos)
      .all<{ codigo_unico: string; id: string; tipo: string; capa_url: string | null; thumb_url: string | null }>();
    for (const row of result.results) {
      const tab = TIPO_D1_PARA_TAB[row.tipo] || "musicas";
      mapa.set(normalizeComparison(row.codigo_unico), {
        topicId: row.id,
        tab,
        imagem: row.thumb_url || row.capa_url || "",
      });
    }
  } catch (err) {
    console.warn("[votacaoController] Falha ao buscar mídia por código único no D1:", err);
  }
  return mapa;
}

// Indicados de categoria ARTIST/GRUPO não têm Código único (o "material" é
// o próprio artista) — usa a foto oficial dele, mesma fonte que Retroativo
// já usa pros awards sem capa de música/álbum.
async function anexarImagens<T extends { titulo: string; artista: string; codigoUnico?: string }>(
  indicados: T[],
): Promise<(T & { imagem: string; topicId: string; tab: string })[]> {
  const codigos = indicados.map((i) => i.codigoUnico || "").filter(Boolean);
  const [porCodigo, fotoPorArtista] = await Promise.all([
    buscarMidiaPorCodigosUnicos(codigos),
    buildFotoPorArtista().catch(() => new Map<string, string>()),
  ]);
  return indicados.map((ind) => {
    const porCodigoInfo = ind.codigoUnico ? porCodigo.get(normalizeComparison(ind.codigoUnico)) : undefined;
    if (porCodigoInfo) {
      return { ...ind, imagem: porCodigoInfo.imagem, topicId: porCodigoInfo.topicId, tab: porCodigoInfo.tab };
    }
    // Sem código único — indicado é o próprio artista/grupo.
    const nomeArtista = ind.artista || ind.titulo;
    const foto = fotoPorArtista.get(normalizeComparison(nomeArtista)) || "";
    return { ...ind, imagem: foto, topicId: "", tab: "" };
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

interface FaseVotacao {
  id: string;
  premiacao: string;
  abertura: string;
  encerramento: string;
  capaUrl: string;
  abaNota: string;
  abaVoto: string;
  status: "agendado" | "aberto" | "encerrado";
}

async function lerFaseVotacao(awardId: string): Promise<FaseVotacao | null> {
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

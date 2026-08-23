import {
  readValues,
  updateValues,
  appendRow,
  normalizeComparison,
  normalizeText,
} from "../services/googleSheetsService";

// Abas fixas da planilha de Premiações — todas com o mesmo formato de
// colunas (A=Ano, B=Segmento, C=Categoria, D=Título, E=Artista).
export const AWARD_TABS = [
  "Grammy Awards",
  "Billboard Music Awards",
  "MTV VMAs",
  "American Music Awards",
  "MTV EMAs",
  "BRIT Awards",
  "Latin Grammys",
  "MAMA Awards",
  "People's Choice",
];

const SPREADSHEET_KEY = "premiacoes";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

/**
 * GET /api/premiacoes/awards
 * Lista fixa das premiações disponíveis (nomes das abas).
 */
export async function getPremiacoesAwardsController(): Promise<Response> {
  return jsonResponse({ success: true, data: AWARD_TABS });
}

/**
 * GET /api/premiacoes/categorias?award=Grammy%20Awards
 * Retorna todas as linhas (Ano/Segmento/Categoria) da aba pedida, pro
 * frontend montar os seletores de Ano > Categoria.
 */
export async function getPremiacoesCategoriasController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const award = url.searchParams.get("award") || "";

  if (!AWARD_TABS.includes(award)) {
    return jsonResponse({ success: false, error: "Premiação inválida." }, 400);
  }

  try {
    const rows = await readValues(SPREADSHEET_KEY, award, "A:E");
    const categorias = rows
      .slice(1)
      .filter((row) => normalizeText(row[0]) && normalizeText(row[2]))
      .map((row) => ({
        ano: normalizeText(row[0]),
        segmento: normalizeText(row[1]),
        categoria: normalizeText(row[2]),
        preenchido: !!(normalizeText(row[3]) || normalizeText(row[4])),
      }));

    return jsonResponse({ success: true, data: categorias });
  } catch (error: any) {
    return jsonResponse(
      { success: false, error: error?.message || "Erro ao ler categorias." },
      500,
    );
  }
}

/**
 * POST /api/premiacoes/preencher
 * body: { award, ano, segmento, categoria, artista, titulo }
 *
 * Regra pedida: nunca sobrescreve um preenchimento já feito. Se a
 * combinação Ano+Segmento+Categoria já tem uma linha com Título/Artista
 * vazios, preenche ela. Se todas as linhas já existentes pra essa
 * categoria estão preenchidas (outro jogador já reivindicou), anexa uma
 * linha nova com a mesma Ano/Segmento/Categoria — cada envio vive na sua
 * própria célula, nada é apagado ou substituído.
 */
export async function postPremiacoesPreencherController(request: Request): Promise<Response> {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ success: false, error: "Corpo inválido." }, 400);
  }

  const award = String(body?.award || "").trim();
  const ano = String(body?.ano || "").trim();
  const segmento = String(body?.segmento || "").trim();
  const categoria = String(body?.categoria || "").trim();
  const artista = String(body?.artista || "").trim();
  const titulo = String(body?.titulo || "").trim();

  if (!AWARD_TABS.includes(award)) {
    return jsonResponse({ success: false, error: "Premiação inválida." }, 400);
  }
  if (!ano || !segmento || !categoria || !artista || !titulo) {
    return jsonResponse({ success: false, error: "Preencha ano, categoria, artista e título." }, 400);
  }

  try {
    const rows = await readValues(SPREADSHEET_KEY, award, "A:E");
    const matchKey = (r: string[]) =>
      normalizeComparison(r[0]) === normalizeComparison(ano) &&
      normalizeComparison(r[1]) === normalizeComparison(segmento) &&
      normalizeComparison(r[2]) === normalizeComparison(categoria);

    let targetRowIndex = -1; // 0-based no array `rows` (linha real = index+1)
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!matchKey(row)) continue;
      const jaPreenchida = !!(normalizeText(row[3]) || normalizeText(row[4]));
      if (!jaPreenchida) {
        targetRowIndex = i;
        break;
      }
    }

    if (targetRowIndex >= 0) {
      const rowNumber = targetRowIndex + 1;
      await updateValues(SPREADSHEET_KEY, award, `D${rowNumber}:E${rowNumber}`, [[titulo, artista]]);
      return jsonResponse({ success: true, data: { mode: "preenchido", linha: rowNumber } });
    }

    // Nenhuma linha vazia pra essa categoria (ou categoria não existia ainda
    // na planilha) — anexa uma linha nova, sem mexer nas existentes.
    const novaLinha = await appendRow(SPREADSHEET_KEY, award, [ano, segmento, categoria, titulo, artista], "A:E");
    if (novaLinha === null) {
      return jsonResponse({ success: false, error: "Não foi possível salvar. Tente novamente." }, 500);
    }
    return jsonResponse({ success: true, data: { mode: "adicionado", linha: novaLinha } });
  } catch (error: any) {
    return jsonResponse({ success: false, error: error?.message || "Erro ao salvar." }, 500);
  }
}

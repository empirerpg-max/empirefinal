import { googleSheetsService } from "../services/googleSheetsService";

// Causa raiz confirmada (2026-10-28, usuário reportou TODAS as abas de
// país de "[Empire] Base de Dados" com "Erro de análise de fórmula"):
// a planilha tem locale pt_BR (confirmado via adminDiagFormulaPaisController
// -> getSpreadsheetLocale), que usa ";" como separador de argumento de
// função e "," como separador decimal — mas a fórmula em A2 de cada aba
// de país (LET/LAMBDA/MAP/QUERY) foi escrita com "," como separador de
// argumento e "." como separador decimal (padrão en_US). O Sheets recusa
// a fórmula inteira com erro de parse, em TODAS as abas ao mesmo tempo,
// porque todas compartilham o mesmo texto-molde.
//
// Esta função converte só FORA de literais de string (preserva o texto
// da query embutida em QUERY(), que usa "," como parte da própria
// linguagem da função QUERY, não como separador de argumento do Sheets):
//   - "," -> ";"  (separador de argumento/LET-binding/linha de array)
//   - "." entre dígitos -> ","  (separador decimal)
function corrigirLocalePtBr(formula: string): string {
  let out = "";
  let inString = false;
  for (let i = 0; i < formula.length; i++) {
    const ch = formula[i];
    if (ch === '"') {
      inString = !inString;
      out += ch;
      continue;
    }
    if (inString) {
      out += ch;
      continue;
    }
    if (ch === ",") {
      out += ";";
      continue;
    }
    if (ch === "." && /\d/.test(formula[i - 1] || "") && /\d/.test(formula[i + 1] || "")) {
      out += ",";
      continue;
    }
    out += ch;
  }
  return out;
}

// GET /api/empire-play/admin/fix-formula-pais-locale?sheets=A,B,C&confirmar=1
// Sem ?confirmar=1: dry-run — devolve a fórmula original e a corrigida
// lado a lado pra conferência, sem gravar nada.
export async function adminFixFormulaPaisLocaleController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const sheetsParam = url.searchParams.get("sheets") || "";
  const sheets = sheetsParam
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const confirmar = url.searchParams.get("confirmar") === "1";

  if (sheets.length === 0) {
    return new Response(JSON.stringify({ success: false, error: "sheets é obrigatório (lista separada por vírgula)." }), {
      status: 400,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  const resultados: Record<
    string,
    { original: string | null; corrigida: string | null; gravado?: boolean; erro?: string }
  > = {};

  for (const sheet of sheets) {
    try {
      const rows = await googleSheetsService.chartsBase.readValues(sheet, "A2:A2", "FORMULA");
      const original = rows?.[0]?.[0] ?? null;
      if (!original) {
        resultados[sheet] = { original: null, corrigida: null, erro: "A2 vazia ou não encontrada." };
        continue;
      }
      const corrigida = corrigirLocalePtBr(String(original));
      if (!confirmar) {
        resultados[sheet] = { original: String(original), corrigida };
        continue;
      }
      const ok = await googleSheetsService.chartsBase.updateValues(sheet, "A2:A2", [[corrigida]]);
      resultados[sheet] = { original: String(original), corrigida, gravado: ok };
    } catch (err) {
      resultados[sheet] = { original: null, corrigida: null, erro: err instanceof Error ? err.message : String(err) };
    }
  }

  return new Response(JSON.stringify({ success: true, confirmar, resultados }, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

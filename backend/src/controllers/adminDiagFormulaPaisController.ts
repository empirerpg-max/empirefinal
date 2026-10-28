import { googleSheetsService } from "../services/googleSheetsService";

// Só leitura. Lê a fórmula RAW (valueRenderOption=FORMULA, não o valor
// calculado) da célula A2 de uma ou mais abas de país em "chartsBase"
// (mesma planilha "[Empire] Base de Dados") — usado pra investigar por que
// todas as abas de país estão com "Erro de análise de fórmula" na UI do
// Sheets (relatado pelo usuário, confirmado visualmente em ÁFRICA DO SUL,
// mas sistêmico em todas).
//
// GET /api/empire-play/admin/diag-formula-pais?sheets=ÁFRICA DO SUL,ALEMANHA,BRASIL
export async function adminDiagFormulaPaisController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const sheetsParam = url.searchParams.get("sheets") || "";
  const sheets = sheetsParam
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (sheets.length === 0) {
    return new Response(JSON.stringify({ success: false, error: "sheets é obrigatório (lista separada por vírgula)." }), {
      status: 400,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  const resultados: Record<string, { formula: string | null; length: number; erro?: string }> = {};

  for (const sheet of sheets) {
    try {
      const rows = await googleSheetsService.chartsBase.readValues(sheet, "A2:A2", "FORMULA");
      const formula = rows?.[0]?.[0] ?? null;
      resultados[sheet] = { formula, length: formula ? String(formula).length : 0 };
    } catch (err) {
      resultados[sheet] = { formula: null, length: 0, erro: err instanceof Error ? err.message : String(err) };
    }
  }

  return new Response(JSON.stringify({ success: true, resultados }, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

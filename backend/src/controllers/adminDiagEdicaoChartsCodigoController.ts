import { googleSheetsService, normalizeComparison, normalizeText } from "../services/googleSheetsService";

// Só leitura. Lê direto de EDIÇÃO CHARTS (fonte real do "Código único",
// coluna BD, gerado por fórmula automática da planilha quando B é
// preenchido) pra ver se o valor de BD já nasce duplicado ali (bug na
// fórmula/planilha) ou se é certo lá e a cópia pra Musicas!Z que erra
// (bug no app, em lerCodigoUnicoGerado/processarFaixasDoAlbum).
//
// GET /api/empire-play/admin/diagnostico-edicao-charts-codigo?q=abaddon
export async function adminDiagEdicaoChartsCodigoController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const q = normalizeComparison(url.searchParams.get("q") || "");
  if (!q) {
    return new Response(JSON.stringify({ success: false, error: "q é obrigatório." }), {
      status: 400,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  const rows = await googleSheetsService.edicaoCharts.readValues("EDIÇÃO CHARTS", "A1:BD20000");
  const encontradas = rows
    .slice(1)
    .map((row, i) => ({
      linha: i + 2,
      A_data: normalizeText(row[0]),
      B_nome: normalizeText(row[1]),
      BD_codigoUnico: normalizeText(row[55]),
    }))
    .filter((r) => normalizeComparison(r.B_nome).includes(q));

  return new Response(JSON.stringify({ success: true, encontradas }, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

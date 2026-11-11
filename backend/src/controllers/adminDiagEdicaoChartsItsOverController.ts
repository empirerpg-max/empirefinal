import { googleSheetsService, normalizeComparison } from "../services/googleSheetsService";

// Diagnóstico pontual (2026-11-11): rows 843 (LOST FREQUENCY) e 844
// ((DON'T) LET ME GO) de Musicas, do álbum "Samantha Cooper - WELL, IT'S
// OVER", ficaram sem Código único (Z) — 843 com lixo ("Data") na célula, 844
// com a célula vazia. Procura em EDIÇÃO CHARTS por essas 2 faixas pra achar
// o código único real (se a entrada existir lá) antes de decidir o fix.
//
// GET /api/gestao/admin/diag-edicao-charts-its-over
export async function adminDiagEdicaoChartsItsOverController(): Promise<Response> {
  const rows = await googleSheetsService.edicaoCharts.readValues("EDIÇÃO CHARTS", "B2:BD20000").catch(() => []);
  const alvo1 = normalizeComparison("Samantha Cooper - LOST FREQUENCY");
  const alvo2 = normalizeComparison("Samantha Cooper - (DON’T) LET ME GO");
  const encontradas = rows
    .map((row, i) => ({ linha: i + 2, row }))
    .filter(
      ({ row }) =>
        normalizeComparison(row?.[0] || "").includes("lost frequency") ||
        normalizeComparison(row?.[0] || "").includes("let me go"),
    )
    .map(({ linha, row }) => ({
      linha,
      titulo: row[0],
      album: row[3],
      codigoUnico: row[54],
    }));

  return new Response(JSON.stringify({ success: true, alvo1, alvo2, encontradas }, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

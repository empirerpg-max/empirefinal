import { googleSheetsService, normalizeText } from "../services/googleSheetsService";

// As últimas N linhas CRUAS de INFOS ACTS, sem filtro nenhum — usado pra
// confirmar com os próprios olhos o que o backfill gravou de verdade
// (já que "criadas"/"falharam" reportados pelo endpoint, e até o
// diagnóstico de match exato, já mentiram ou bateram zero antes).
//
// GET /api/empire-play/admin/diagnostico-ultimas-linhas-infos-acts?n=15
export async function adminDiagUltimasLinhasInfosActsController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const n = Number(url.searchParams.get("n")) || 15;

  const rows = await googleSheetsService.registrosCharts.readValues("INFOS ACTS");
  const total = rows.length;
  const ultimas = rows.slice(-n).map((row, i) => ({
    linha: total - Math.min(n, rows.length) + i + 1,
    A: normalizeText(row[0]),
    raw: row,
  }));

  return new Response(JSON.stringify({ success: true, totalLinhas: total, ultimas }, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

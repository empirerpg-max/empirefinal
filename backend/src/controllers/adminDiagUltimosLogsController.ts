import { googleSheetsService, normalizeText } from "../services/googleSheetsService";

// Lê as últimas N linhas da aba LOGS (planilha logsSistema) — usado pra
// investigar por que o backfill de INFOS ACTS está falhando silenciosamente
// pra todo mundo (criadas:0, falharam: todos). Sem isso, a única causa
// registrada (appendRow grava em LOGS na falha) fica invisível.
//
// GET /api/empire-play/admin/diagnostico-ultimos-logs?n=10
export async function adminDiagUltimosLogsController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const n = Number(url.searchParams.get("n")) || 10;

  const rows = await googleSheetsService.logsSistema.readValues("LOGS").catch((err) => {
    throw new Error(`Falha ao ler LOGS: ${(err as Error).message}`);
  });

  const ultimas = rows.slice(1).slice(-n).map((row) => ({
    data: normalizeText(row[0]),
    categoria: normalizeText(row[1]),
    oQueAconteceu: normalizeText(row[2]),
    onde: normalizeText(row[3]),
    causaProvavel: normalizeText(row[4]),
    comoResolver: normalizeText(row[5]),
    detalheTecnico: normalizeText(row[6]),
  }));

  return new Response(JSON.stringify({ success: true, totalLinhas: rows.length, ultimas }, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

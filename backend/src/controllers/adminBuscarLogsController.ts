import { googleSheetsService, normalizeComparison } from "../services/googleSheetsService";

// Busca read-only na aba LOGS (planilha logsSistema) por texto livre —
// pra investigar se uma tentativa de ação (ex: comentário que falhou ao
// gravar) deixou algum rastro nos logs didáticos do sistema
// (registrarLogSistema, services/logSistemaService.ts).
//
// GET /api/empire-play/admin/buscar-logs?q=Weuller
export async function adminBuscarLogsController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const busca = normalizeComparison(url.searchParams.get("q") || "");
  if (!busca) {
    return new Response(JSON.stringify({ success: false, error: "Parâmetro q obrigatório." }), {
      status: 400,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  const rows = await googleSheetsService.logsSistema.readValues("LOGS").catch(() => []);
  const achados = rows
    .map((row, i) => ({ linha: i + 1, row }))
    .filter(({ row }) => normalizeComparison((row || []).join(" | ")).includes(busca))
    .slice(-50);

  return new Response(JSON.stringify({ success: true, busca, total: achados.length, achados }, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

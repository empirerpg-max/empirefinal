import { googleSheetsService, normalizeComparison, normalizeText } from "../services/googleSheetsService";

// Diagnóstico read-only: busca linhas em REGISTRO por nome de jogador (e
// opcionalmente por trecho do título) — usado pra confirmar se um
// comentário específico gerou (ou não) entrada no Audit Log.
//
// GET /api/empire-play/admin/diagnostico-registro?jogador=Chris&titulo=nostalgic
export async function adminDiagRegistroController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const jogador = normalizeComparison(url.searchParams.get("jogador") || "");
  const titulo = normalizeComparison(url.searchParams.get("titulo") || "");
  if (!jogador) {
    return new Response(JSON.stringify({ success: false, error: "Use ?jogador=<nome>" }), {
      status: 400,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  const rows = await googleSheetsService.registrosCharts.readValues("REGISTRO").catch(() => []);
  const achadas: Record<string, unknown>[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    const nomeJogador = normalizeComparison(row[1] || "");
    const conteudo = normalizeText(row[2] || "");
    if (nomeJogador !== jogador) continue;
    if (titulo && !normalizeComparison(conteudo).includes(titulo)) continue;
    achadas.push({ linha: i + 1, jogador: row[1] || "", conteudo, tipo: row[3] || "" });
  }

  return new Response(
    JSON.stringify({ success: true, jogador: url.searchParams.get("jogador"), totalLinhasRegistro: rows.length, achadas }, null, 2),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
}

import { googleSheetsService, normalizeText, normalizeComparison } from "../services/googleSheetsService";

// Diagnóstico read-only: dump cru da linha de "Music Videos" pra um título
// (busca substring) — usado pra investigar vídeos que não carregam
// ("Não foi possível carregar o vídeo") sem adivinhar qual coluna/fonte
// está errada.
//
// GET /api/empire-play/admin/diagnostico-video?titulo=...
export async function adminDiagVideoController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const titulo = normalizeText(url.searchParams.get("titulo") || "");
  if (!titulo) {
    return new Response(JSON.stringify({ success: false, error: "Use ?titulo=<nome do vídeo>" }), {
      status: 400,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  const alvoNorm = normalizeComparison(titulo);
  const rows = await googleSheetsService.principal.readValues("Music Videos").catch(() => []);
  const headers = (rows[0] || []).map((h) => normalizeText(h));
  const achadas: Record<string, unknown>[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    const rowText = row.join(" ");
    if (!normalizeComparison(rowText).includes(alvoNorm)) continue;
    const obj: Record<string, unknown> = { linha: i + 1 };
    headers.forEach((h, idx) => {
      obj[h || `coluna_${idx + 1}`] = row[idx] || "";
    });
    achadas.push(obj);
  }

  return new Response(JSON.stringify({ success: true, busca: titulo, headers, achadas }, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

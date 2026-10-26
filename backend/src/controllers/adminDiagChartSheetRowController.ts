import { googleSheetsService, normalizeComparison } from "../services/googleSheetsService";

// Só leitura. Lê uma linha crua (todas as colunas, com cabeçalho) de uma
// das 3 abas de chart do Início (Top_50_Spotify, Top_Songs_Apple_Music,
// Top_Videos_YT) que casa por substring no título — essas abas não têm
// coluna própria de artista (o "Título" vem como "Artista - Música") e às
// vezes têm (ou não) uma coluna de capa própria, cruzada com o catálogo
// via enrichWithCover em getEmpirePlayHomeController quando vazia.
//
// GET /api/empire-play/admin/diagnostico-chart-sheet-row?sheet=Top_50_Spotify&q=stamp
export async function adminDiagChartSheetRowController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const sheet = url.searchParams.get("sheet") || "Top_50_Spotify";
  const q = normalizeComparison(url.searchParams.get("q") || "");
  if (!q) {
    return new Response(JSON.stringify({ success: false, error: "q é obrigatório." }), {
      status: 400,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  const objetos = await googleSheetsService.principal.readSheetObjects(sheet).catch(() => []);
  const achados = objetos.filter((obj) =>
    Object.values(obj).some((v) => normalizeComparison(String(v || "")).includes(q)),
  );

  return new Response(JSON.stringify({ success: true, sheet, achados }, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

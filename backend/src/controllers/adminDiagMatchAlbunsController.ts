import { googleSheetsService, normalizeComparison } from "../services/googleSheetsService";

// Diagnóstico pontual (2026-11-11): /api/editar?artist=Samantha+Cooper&tipo=albuns
// só retorna 1 álbum. Replica EXATAMENTE a lógica de match de
// getReleasesForEditController (editController.ts) linha a linha, pras
// linhas pedidas, reportando cada passo intermediário — pra achar onde
// diverge do esperado.
//
// GET /api/gestao/admin/diag-match-albuns?artist=Samantha+Cooper&linhas=77,84,105
export async function adminDiagMatchAlbunsController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const artistParam = url.searchParams.get("artist") || "";
  const linhasParam = url.searchParams.get("linhas") || "";
  const linhasAlvo = new Set(
    linhasParam.split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => Number.isFinite(n)),
  );

  const rawRows = await googleSheetsService.principal.readValues("Albuns").catch(() => []);
  const normArtist = normalizeComparison(artistParam);

  const resultados: unknown[] = [];
  for (let i = 1; i < rawRows.length; i++) {
    const rowIndex = i + 1;
    if (!linhasAlvo.has(rowIndex)) continue;
    const row = rawRows[i];

    const title = row[6] || "";
    let artist = row[5] || "";
    if (!artist) artist = "(vazio, cairia no fallback de header)";

    const rowText = row.join(" ");
    const normRowText = normalizeComparison(rowText);
    const normArtistField = normalizeComparison(row[5] || "");

    const batePorArtistField = normArtistField.includes(normArtist);
    const batePorRowText = normRowText.includes(normArtist);

    resultados.push({
      rowIndex,
      title,
      artistFieldRaw: row[5],
      normArtist,
      normArtistField,
      batePorArtistField,
      normRowTextContemBusca: batePorRowText,
      normRowTextTrecho: normRowText.slice(0, 200),
      matchFinal: batePorArtistField || batePorRowText,
    });
  }

  return new Response(JSON.stringify({ success: true, totalRows: rawRows.length, artistParam, normArtist, resultados }, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

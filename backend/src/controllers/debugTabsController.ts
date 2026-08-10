import { googleSheetsService, normalizeComparison } from "../services/googleSheetsService";

export async function debugDumpAlbumTracksController(): Promise<Response> {
  try {
    const albumRows = await googleSheetsService.principal.readValues("Albuns");
    const musicaRows = await googleSheetsService.principal.readValues("Musicas");

    const albumMatch = albumRows.find((r) => normalizeComparison(r.join(" ")).includes("villain"));

    const musicaMatches = musicaRows
      .slice(1)
      .filter((r) => normalizeComparison(r[10] || "").includes("villain")) // K = index 10
      .map((r) => ({ H_titulo: r[7], K_album: r[10], U_ordem: r[20] }));

    return new Response(
      JSON.stringify({
        success: true,
        albumRow: albumMatch,
        musicasHeader: musicaRows[0],
        musicaMatches,
        totalMusicas: musicaRows.length - 1,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (error: any) {
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

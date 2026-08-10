import {
  googleSheetsService,
  normalizeComparison,
  normalizeHeader,
  dedupeHeaders,
} from "../services/googleSheetsService";

export async function debugDumpIdentidadeController(): Promise<Response> {
  try {
    const usuariosRows = await googleSheetsService.usuarios.readValues("Usuários");
    const artistasRows = await googleSheetsService.usuarios.readValues("ARTISTAS");

    const usuariosHeaders = usuariosRows[0] || [];
    const hugoRows = usuariosRows
      .slice(1)
      .filter((r) => normalizeComparison(r.join(" ")).includes("hugo"));

    const artistasHeaders = artistasRows[0] || [];
    const artistasHugoRows = artistasRows
      .slice(1)
      .filter((r) => normalizeComparison(r.join(" ")).includes("hugo"));

    return new Response(
      JSON.stringify({
        success: true,
        usuariosHeaders,
        hugoRows,
        artistasHeaders,
        artistasHugoRows,
        artistasSampleRows: artistasRows.slice(1, 6),
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

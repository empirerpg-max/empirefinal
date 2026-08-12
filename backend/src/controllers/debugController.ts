import { googleSheetsService } from "../services/googleSheetsService";

// TEMPORÁRIO — confere as colunas reais da aba ARTISTAS antes de migrar o
// fluxo de vincular/criar artista pra gravar nela.
export async function debugArtistasSheetController(): Promise<Response> {
  const rows = await googleSheetsService.usuarios.readValues("ARTISTAS", "A1:Z10").catch((err) => {
    throw err;
  });
  return new Response(JSON.stringify({ rows }, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

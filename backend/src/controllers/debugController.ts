import { googleSheetsService } from "../services/googleSheetsService";

// TEMPORÁRIO — investiga por que comentários do fórum não geram registro em
// REGISTRO. Lê as últimas linhas de REGISTRO e dos comentários recentes.
export async function debugRegistroController(): Promise<Response> {
  const [registro, comentariosMusicas, comentariosMV, comentariosAlbuns] = await Promise.all([
    googleSheetsService.registrosCharts.readValues("REGISTRO").catch((e) => [["erro", String(e)]]),
    googleSheetsService.principal.readValues("Comentarios_Musicas").catch((e) => [["erro", String(e)]]),
    googleSheetsService.principal.readValues("Comentarios_MV").catch((e) => [["erro", String(e)]]),
    googleSheetsService.principal.readValues("Comentarios_Albuns").catch((e) => [["erro", String(e)]]),
  ]);

  return new Response(
    JSON.stringify(
      {
        registro_ultimas_10: registro.slice(-10),
        comentarios_musicas_ultimas_5: comentariosMusicas.slice(-5),
        comentarios_mv_ultimas_5: comentariosMV.slice(-5),
        comentarios_albuns_ultimas_5: comentariosAlbuns.slice(-5),
      },
      null,
      2,
    ),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

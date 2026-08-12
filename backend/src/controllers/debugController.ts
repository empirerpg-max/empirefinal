import { googleSheetsService, normalizeComparison } from "../services/googleSheetsService";

// TEMPORÁRIO — investiga por que comentários do fórum não geram registro em
// REGISTRO. Lê as últimas linhas de REGISTRO e dos comentários recentes.
export async function debugRegistroController(): Promise<Response> {
  const [registro, comentariosMusicas, comentariosMV, comentariosAlbuns, musicas] = await Promise.all([
    googleSheetsService.registrosCharts.readValues("REGISTRO").catch((e) => [["erro", String(e)]]),
    googleSheetsService.principal.readValues("Comentarios_Musicas").catch((e) => [["erro", String(e)]]),
    googleSheetsService.principal.readValues("Comentarios_MV").catch((e) => [["erro", String(e)]]),
    googleSheetsService.principal.readValues("Comentarios_Albuns").catch((e) => [["erro", String(e)]]),
    googleSheetsService.principal.readValues("Musicas").catch((e) => [["erro", String(e)]]),
  ]);

  const registroDoAlan = registro.filter((row) => normalizeComparison(row[1]).includes("alan"));
  const comentariosAlanMusicas = comentariosMusicas.filter((row) => normalizeComparison(row[2]) === "alan");
  // Acha o título das músicas dos tópicos 2138/2146 (coluna B = ID do tópico) pra
  // saber o que buscar em REGISTRO.
  const topicosAlvo = new Set(comentariosAlanMusicas.map((row) => row[0]));
  const titulosTopicos = musicas
    .filter((row) => topicosAlvo.has(row[1]))
    .map((row) => ({ topicId: row[1], titulo: row[2] || row[0] }));

  return new Response(
    JSON.stringify(
      {
        registro_do_alan_todas_ocorrencias: registroDoAlan,
        comentarios_do_alan_em_musicas: comentariosAlanMusicas,
        titulos_dos_topicos_comentados_pelo_alan: titulosTopicos,
        total_linhas_registro: registro.length,
      },
      null,
      2,
    ),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

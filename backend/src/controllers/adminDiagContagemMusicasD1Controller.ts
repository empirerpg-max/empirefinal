import { getCatalogoDb } from "../services/catalogoDbService";

// Diagnóstico read-only: getEmpirePlayMusicasController (Catálogo/Fórum)
// devolveu só 196 itens em produção depois do pivot pra D1, quando o
// esperado era ~766 (772 migradas - ~6 sem título/pendente de verdade) —
// investiga se é a contagem real da tabela, o campo `pendente`, ou outra
// coisa filtrando demais.
//
// GET /api/empire-play/admin/diagnostico-contagem-musicas-d1
export async function adminDiagContagemMusicasD1Controller(): Promise<Response> {
  const db = getCatalogoDb();
  if (!db) {
    return new Response(JSON.stringify({ success: false, error: "Binding CATALOGO_DB não disponível." }), {
      status: 500,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  const total = await db.prepare("SELECT COUNT(*) as n FROM musicas").all<{ n: number }>();
  const pendentes = await db
    .prepare("SELECT COUNT(*) as n FROM musicas WHERE pendente = 1")
    .all<{ n: number }>();
  const semTitulo = await db
    .prepare("SELECT COUNT(*) as n FROM musicas WHERE titulo IS NULL OR titulo = ''")
    .all<{ n: number }>();
  const amostra = await db.prepare("SELECT codigo_unico, id_topico, titulo, pendente FROM musicas LIMIT 10").all();

  return new Response(
    JSON.stringify(
      {
        success: true,
        totalNaTabela: total.results?.[0]?.n ?? null,
        comPendenteIgual1: pendentes.results?.[0]?.n ?? null,
        semTitulo: semTitulo.results?.[0]?.n ?? null,
        amostra: amostra.results,
      },
      null,
      2,
    ),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
}

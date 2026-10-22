import { getCatalogoDb } from "../services/musicasDbService";

// Checagem pós-fix: adminFixDuplicataMvAlchimiaController reportou
// midiaFantasmaRemovida=false ao tentar apagar o registro fantasma (D1
// midia, id=video_1792675385825_bl0ecf) criado pela duplicata em Music
// Videos. Confirma se a linha ainda existe (fix falhou de verdade) ou já
// não existia mais (nada a fazer).
//
// GET /api/empire-play/admin/diagnostico-midia-fantasma-alchimia
export async function adminDiagMidiaFantasmaAlchimiaController(): Promise<Response> {
  const TOPIC_ID_DUPLICATA = "video_1792675385825_bl0ecf";
  const db = getCatalogoDb();
  if (!db) {
    return new Response(JSON.stringify({ success: false, error: "D1 indisponível" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
  const r = await db.prepare("SELECT * FROM midia WHERE id = ?").bind(TOPIC_ID_DUPLICATA).all().catch((err) => ({
    error: String(err),
  }));
  return new Response(JSON.stringify({ success: true, resultado: r }, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

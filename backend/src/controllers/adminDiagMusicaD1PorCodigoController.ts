import { getCatalogoDb } from "../services/catalogoDbService";

// Diagnóstico read-only: dump da linha D1 de `musicas` por código único —
// pra conferir se o Fórum > Músicas (que lê do D1) está mostrando dado
// atualizado depois de uma correção feita direto no Sheets (ver
// adminFixFaixaRaynaController.ts) — a correção no Sheets não espelha pro
// D1 sozinha, só a próxima escrita real (publicar/editar) faz isso.
//
// GET /api/empire-play/admin/diagnostico-musica-d1?codigoUnico=EMP686
export async function adminDiagMusicaD1PorCodigoController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const codigoUnico = (url.searchParams.get("codigoUnico") || "").trim();
  if (!codigoUnico) {
    return new Response(JSON.stringify({ success: false, error: "Use ?codigoUnico=<código>" }), {
      status: 400,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }
  const db = getCatalogoDb();
  if (!db) {
    return new Response(JSON.stringify({ success: false, error: "Binding CATALOGO_DB não disponível." }), {
      status: 500,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }
  const result = await db.prepare("SELECT * FROM musicas WHERE codigo_unico = ?").bind(codigoUnico).all();
  return new Response(JSON.stringify({ success: true, linhas: result.results || [] }, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

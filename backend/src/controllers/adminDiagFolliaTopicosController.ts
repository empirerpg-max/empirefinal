import { getCatalogoDb } from "../services/musicasDbService";
import { googleSheetsService, normalizeText, normalizeComparison } from "../services/googleSheetsService";

// Usuário reportou: faixas PENDENTES do álbum FOLLIA (Max Gorghan) estão
// aparecendo no Fórum como tópicos clicáveis ("ACESSAR"), mesmo sendo
// pendente="Sim" (não deveriam ter tópico aberto ainda). Usuário já
// corrigiu manualmente no Sheets (uma por uma), mas o D1 (fonte real de
// leitura do Fórum) não foi tocado. Dump comparando Sheets atual x D1
// atual pras 9 faixas do FOLLIA, pra ver a divergência exata antes de
// sincronizar.
//
// GET /api/empire-play/admin/diagnostico-follia-topicos
export async function adminDiagFolliaTopicosController(): Promise<Response> {
  const ALBUM_TITULO = "Max Gorghan - FOLLIA";
  const rows = await googleSheetsService.principal.readValues("Musicas", "A1:AE2000").catch(() => []);

  const sheetRows: Record<string, unknown>[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    const album = normalizeText(row[10]);
    if (normalizeComparison(album) !== normalizeComparison(ALBUM_TITULO)) continue;
    sheetRows.push({
      linha: i + 1,
      titulo: normalizeText(row[7]),
      idDoTopico: normalizeText(row[1]),
      comentariosPara: normalizeText(row[5]),
      pendente: normalizeText(row[23]),
      codigoUnico: normalizeText(row[25]),
    });
  }

  const db = getCatalogoDb();
  let d1Rows: unknown[] = [];
  if (db) {
    const r = await db
      .prepare("SELECT codigo_unico, id_topico, titulo, comentarios_para, pendente FROM musicas WHERE album = ?")
      .bind(ALBUM_TITULO)
      .all()
      .catch(() => null);
    d1Rows = r?.results || [];

    const r2 = await db
      .prepare(
        "SELECT id, tipo, titulo, comentarios_para, pendente FROM midia WHERE titulo LIKE '%Follia%' OR titulo LIKE '%Alchimia%' OR titulo LIKE '%Dolce%' OR titulo LIKE '%Calma%' OR titulo LIKE '%Americana%' OR titulo LIKE '%Riccordi%' OR titulo LIKE '%Artificiale%' OR titulo LIKE '%volte%'",
      )
      .all()
      .catch(() => null);
    d1Rows = { musicas: d1Rows, midia: r2?.results || [] } as unknown as unknown[];
  }

  return new Response(
    JSON.stringify({ success: true, sheetRows, d1Rows }, null, 2),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
}

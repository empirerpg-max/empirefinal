import { getCatalogoDb } from "../services/musicasDbService";
import { googleSheetsService, normalizeText, normalizeComparison } from "../services/googleSheetsService";

// Diagnóstico read-only: investiga duplicata de faixas da Loreena/LOREENA
// relatada pelo usuário — dump de TODAS as linhas no D1 (`musicas`) e no
// Sheets (`Musicas`) cujo artista bate (case-insensitive) com "loreena",
// pra confirmar se são linhas DE VERDADE duplicadas na fonte (Sheets,
// refletidas no D1) ou se é o código lendo D1+Sheets junto em algum lugar.
//
// GET /api/empire-play/admin/diagnostico-loreena
export async function adminDiagLoreenaController(): Promise<Response> {
  const db = getCatalogoDb();
  let d1Rows: unknown[] = [];
  if (db) {
    const result = await db
      .prepare("SELECT codigo_unico, id_topico, titulo, artista, pendente FROM musicas WHERE LOWER(artista) = 'loreena'")
      .all()
      .catch(() => null);
    d1Rows = result?.results || [];
  }

  const sheetRows = await googleSheetsService.principal.readValues("Musicas", "A:AE").catch(() => []);
  const sheetAchadas: Record<string, unknown>[] = [];
  for (let i = 1; i < sheetRows.length; i++) {
    const row = sheetRows[i];
    if (!row) continue;
    const artista = normalizeText(row[13]);
    if (normalizeComparison(artista) !== "loreena") continue;
    sheetAchadas.push({
      linha: i + 1,
      artista,
      nome: normalizeText(row[7]),
      codigoUnico: normalizeText(row[25]),
      pendente: normalizeText(row[23]),
      idDoTopico: normalizeText(row[1]),
    });
  }

  return new Response(
    JSON.stringify({ success: true, totalD1: d1Rows.length, d1Rows, totalSheets: sheetAchadas.length, sheetAchadas }, null, 2),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
}

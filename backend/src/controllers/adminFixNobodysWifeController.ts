import { googleSheetsService, normalizeComparison } from "../services/googleSheetsService";
import { getCatalogoDb } from "../services/catalogoDbService";

// Corrige o título corrompido "ACT PRINCIPAL - ACT PRINCIPAL - Nobody's
// Wife" pro valor certo "Jessica Johnson - Nobody's Wife" — confirmado
// via admin/diag-nobodys-wife: Musicas!H (linha 829) e EDIÇÃO
// CHARTS!B (linha 998), mesmo código único EMP997 nos dois.
//
// GET /api/empire-play/admin/fix-nobodys-wife?confirmar=1
export async function adminFixNobodysWifeController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const confirmar = url.searchParams.get("confirmar") === "1";
  const TITULO_CORRETO = "Jessica Johnson - Nobody's Wife";
  const CODIGO = "emp997";

  const musicasRows = await googleSheetsService.principal.readValues("Musicas", "A1:AE50000").catch(() => []);
  let linhaMusicas = -1;
  for (let i = 1; i < musicasRows.length; i++) {
    const row = musicasRows[i];
    if (row && normalizeComparison(row[25]) === CODIGO) {
      linhaMusicas = i + 1;
      break;
    }
  }

  const edicaoRows = await googleSheetsService.edicaoCharts.readValues("EDIÇÃO CHARTS", "A1:BD20000").catch(() => []);
  let linhaEdicao = -1;
  for (let i = 1; i < edicaoRows.length; i++) {
    const row = edicaoRows[i];
    if (row && normalizeComparison(row[55]) === CODIGO) {
      linhaEdicao = i + 1;
      break;
    }
  }

  if (!confirmar) {
    return new Response(JSON.stringify({ success: true, confirmar, linhaMusicas, linhaEdicao, tituloCorreto: TITULO_CORRETO }, null, 2), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  const gravados: { onde: string; gravado: boolean }[] = [];
  if (linhaMusicas > 0) {
    const ok = await googleSheetsService.principal.updateValues("Musicas", `H${linhaMusicas}:H${linhaMusicas}`, [[TITULO_CORRETO]]);
    gravados.push({ onde: `Musicas!H${linhaMusicas}`, gravado: ok });
  }
  if (linhaEdicao > 0) {
    const ok = await googleSheetsService.edicaoCharts.updateValues("EDIÇÃO CHARTS", `B${linhaEdicao}:B${linhaEdicao}`, [[TITULO_CORRETO]]);
    gravados.push({ onde: `EDIÇÃO CHARTS!B${linhaEdicao}`, gravado: ok });
  }

  const db = getCatalogoDb();
  if (db) {
    try {
      await db.prepare(`UPDATE midia SET titulo = ? WHERE codigo_unico = ? AND tipo = 'musica'`).bind(TITULO_CORRETO, "EMP997").run();
      gravados.push({ onde: "D1 midia.titulo", gravado: true });
    } catch (err) {
      gravados.push({ onde: "D1 midia.titulo", gravado: false });
    }
  }

  return new Response(JSON.stringify({ success: true, confirmar, linhaMusicas, linhaEdicao, gravados }, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

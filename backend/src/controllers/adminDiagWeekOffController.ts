import { readValues } from "../services/googleSheetsService";

// Diagnóstico read-only: jogador Filipe reportou bloqueio de cooldown do
// Week Off ("faltam 76 dias") sem lembrar de ter comprado recentemente.
// Dump de TODAS as linhas de Market_Compras com ProdutoID "week_off",
// pra confirmar se existe mesmo uma compra recente dele (e de quem mais,
// pra descartar erro de comparação/match).
//
// GET /api/empire-play/admin/diagnostico-week-off?nome=Filipe
export async function adminDiagWeekOffController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const nomeFiltro = (url.searchParams.get("nome") || "").toLowerCase();

  const rows = await readValues("usuarios", "Market_Compras").catch(() => []);
  const header = rows[0] || [];
  const weekOffRows: Record<string, unknown>[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] || [];
    if ((row[3] || "").trim() !== "week_off") continue;
    const usuario = (row[2] || "").trim();
    if (nomeFiltro && !usuario.toLowerCase().includes(nomeFiltro)) continue;
    weekOffRows.push({
      linha: i + 1,
      data: row[0],
      telegramId: row[1],
      usuario,
      produtoId: row[3],
      produto: row[4],
      artista: row[9],
      semana: row[10],
    });
  }

  return new Response(
    JSON.stringify({ success: true, header, totalWeekOff: weekOffRows.length, weekOffRows }, null, 2),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
}

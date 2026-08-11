import { googleSheetsService, normalizeHeader, normalizeText, dedupeHeaders } from "../services/googleSheetsService";

// Controller temporário só pra inspecionar dados reais de uma aba.
// REMOVER antes do merge final.
export async function debugDumpController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const sheet = url.searchParams.get("sheet") || "Usuários";
  const filterCol = url.searchParams.get("filterCol");
  const filterVal = url.searchParams.get("filterVal");

  const rawRows = await googleSheetsService.usuarios.readValues(sheet).catch((e) => {
    throw new Error(`Erro lendo ${sheet}: ${e.message || e}`);
  });

  if (!rawRows || rawRows.length < 1) {
    return new Response(JSON.stringify({ success: true, headers: [], rows: [] }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  const headers = dedupeHeaders(
    sheet,
    rawRows[0].map((h, i) => normalizeHeader(h) || `coluna_${i + 1}`),
  );

  let rows = rawRows.slice(1).map((row) => {
    const rec: Record<string, string> = {};
    headers.forEach((h, hi) => {
      rec[h] = normalizeText(row[hi]);
    });
    return rec;
  });

  if (filterCol && filterVal) {
    rows = rows.filter((r) => (r[filterCol] || "").toLowerCase().includes(filterVal.toLowerCase()));
  }

  return new Response(JSON.stringify({ success: true, headers, rows: rows.slice(0, 10) }, null, 2), {
    headers: { "Content-Type": "application/json" },
  });
}

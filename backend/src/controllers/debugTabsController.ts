import { getGoogleAccessToken } from "../google/service-account";
import { SPREADSHEETS, readValues, normalizeHeader, normalizeText, dedupeHeaders } from "../services/googleSheetsService";

// Controller temporário só pra inspecionar dados reais de uma planilha/aba.
// REMOVER antes do merge final.
export async function debugDumpController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const spreadsheet = (url.searchParams.get("spreadsheet") || "principal") as keyof typeof SPREADSHEETS;
  const sheet = url.searchParams.get("sheet");

  if (!sheet) {
    // Sem "sheet": lista os nomes das abas dessa planilha.
    const id = SPREADSHEETS[spreadsheet] || spreadsheet;
    const token = await getGoogleAccessToken(["https://www.googleapis.com/auth/spreadsheets.readonly"]);
    const res = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${id}?fields=sheets.properties.title`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const json = await res.json();
    return new Response(JSON.stringify({ success: true, sheets: json }, null, 2), {
      headers: { "Content-Type": "application/json" },
    });
  }

  const rawRows = await readValues(spreadsheet, sheet).catch((e: any) => {
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

  const rows = rawRows.slice(1, 6).map((row) => {
    const rec: Record<string, string> = {};
    headers.forEach((h, hi) => {
      rec[h] = normalizeText(row[hi]);
    });
    return rec;
  });

  return new Response(JSON.stringify({ success: true, headers, totalRows: rawRows.length - 1, rows }, null, 2), {
    headers: { "Content-Type": "application/json" },
  });
}

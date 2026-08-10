import { googleSheetsService, SPREADSHEETS } from "../services/googleSheetsService";

async function listTabs(spreadsheetId: string): Promise<string[]> {
  const { getGoogleAccessToken } = await import("../google/service-account");
  const token = await getGoogleAccessToken(["https://www.googleapis.com/auth/spreadsheets.readonly"]);
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties.title`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const data = (await res.json()) as { sheets?: { properties?: { title?: string } }[] };
  return (data.sheets || []).map((s) => s.properties?.title || "").filter(Boolean);
}

export async function debugDumpEdicaoChartsController(): Promise<Response> {
  try {
    const tabs = await listTabs(SPREADSHEETS.edicaoCharts);
    const headerRows: Record<string, string[][]> = {};
    for (const tab of tabs) {
      try {
        headerRows[tab] = await googleSheetsService.edicaoCharts.readValues(tab, "A1:H5");
      } catch (err) {
        headerRows[tab] = [[`ERRO: ${(err as Error).message}`]];
      }
    }
    return new Response(JSON.stringify({ success: true, tabs, headerRows }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

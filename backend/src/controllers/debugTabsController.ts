import { googleSheetsService } from "../services/googleSheetsService";

export async function debugDumpSheetController(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const sheetName = url.searchParams.get("sheet") || "REGISTRO DE MÚSICA";
    const rows = await googleSheetsService.registrosCharts.readValues(sheetName, "A1:P5");
    return new Response(JSON.stringify({ sheetName, rows }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

import { googleSheetsService } from "../services/googleSheetsService";

export async function debugDumpPontosController(): Promise<Response> {
  try {
    const rows = await googleSheetsService.registrosCharts.readValues("Pontos", "A1:P10");
    return new Response(JSON.stringify({ success: true, rows }), {
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

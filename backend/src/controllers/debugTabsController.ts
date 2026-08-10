import { googleSheetsService } from "../services/googleSheetsService";

export async function debugDumpMusicVideosHeaderController(): Promise<Response> {
  try {
    const rows = await googleSheetsService.principal.readValues("Music Videos", "A1:V3");
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

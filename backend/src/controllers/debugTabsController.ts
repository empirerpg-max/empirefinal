import { googleSheetsService, SPREADSHEETS } from "../services/googleSheetsService";
import { getGoogleAccessToken } from "../google/service-account";

export async function debugListTabsController(): Promise<Response> {
  try {
    const token = await getGoogleAccessToken(["https://www.googleapis.com/auth/spreadsheets.readonly"]);
    const res = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEETS.usuarios}?fields=sheets.properties.title`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const json = await res.json();
    return new Response(JSON.stringify(json), {
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

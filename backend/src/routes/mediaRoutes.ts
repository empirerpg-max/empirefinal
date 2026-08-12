import { streamDriveFileController } from "../controllers/mediaController";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Range",
};

export async function handleMediaRoutes(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  const pathname = url.pathname;

  const isMediaRoute =
    pathname.startsWith("/api/media/audio") ||
    pathname.startsWith("/api/media/video") ||
    pathname.startsWith("/api/media/image");

  if (!isMediaRoute) {
    return null;
  }

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response(
      JSON.stringify({
        success: false,
        error: "Método HTTP não suportado. Use GET para streaming de mídia.",
      }),
      { status: 405, headers: { "Content-Type": "application/json" } },
    );
  }

  const response = await streamDriveFileController(request);

  // Anexa cabeçalhos CORS
  const headers = new Headers(response.headers);
  Object.entries(CORS_HEADERS).forEach(([key, val]) => {
    headers.set(key, val);
  });

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

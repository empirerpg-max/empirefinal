import { normalizeText } from "../services/googleSheetsService";
import { getDriveOAuthAccessToken } from "../google/service-account";

/**
 * GET /api/media/audio ou /api/media/video
 * Proxy de streaming autenticado pro Google Drive, com suporte a HTTP Range
 * (206) pra seek instantâneo. Usa a API do Drive (não o link público de
 * download) porque arquivos grandes — comum em vídeo — fazem o link público
 * mostrar uma página de confirmação "não foi possível verificar vírus" em
 * vez do arquivo. O player nunca vê nada do Drive: só bytes de mídia crus,
 * como se fosse um arquivo do próprio app.
 */
export async function streamDriveFileController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const rawId = normalizeText(
    url.searchParams.get("id") || url.searchParams.get("file_id") || url.pathname.split("/").pop(),
  );

  if (!rawId) {
    return new Response(JSON.stringify({ success: false, message: "ID de mídia não informado." }), {
      status: 400,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  const match = rawId.match(/[-\w]{25,}/);
  const fileId = match ? match[0] : rawId;

  try {
    const token = await getDriveOAuthAccessToken();
    const range = request.headers.get("range");
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    if (range) headers["Range"] = range;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    let driveRes: Response;
    try {
      driveRes = await fetch(
        `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
        { headers, signal: controller.signal },
      );
    } finally {
      clearTimeout(timeout);
    }

    if (!driveRes.ok) {
      return new Response(
        JSON.stringify({ success: false, message: `Drive respondeu HTTP ${driveRes.status}.` }),
        { status: driveRes.status, headers: { "Content-Type": "application/json; charset=utf-8" } },
      );
    }

    const resHeaders = new Headers();
    resHeaders.set("Content-Type", driveRes.headers.get("content-type") || "application/octet-stream");
    resHeaders.set("Accept-Ranges", "bytes");
    // Sem isso, o navegador refazia a busca completa no Drive toda vez que a
    // página recarregava — mesmo pro mesmo vídeo, pro mesmo trecho de bytes
    // (ex: o preview de metadata das thumbnails congeladas em Catálogo >
    // Vídeos). O conteúdo de um file_id do Drive não muda sozinho, então uma
    // resposta (inclusive parcial/206) pode ficar em cache por bastante tempo.
    resHeaders.set("Cache-Control", "public, max-age=604800, immutable");
    if (driveRes.headers.has("content-length")) {
      resHeaders.set("Content-Length", driveRes.headers.get("content-length")!);
    }
    if (driveRes.headers.has("content-range")) {
      resHeaders.set("Content-Range", driveRes.headers.get("content-range")!);
    }

    return new Response(driveRes.body, { status: driveRes.status, headers: resHeaders });
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "AbortError";
    console.error("[streamDriveFileController] Erro ao transmitir mídia:", err);
    return new Response(
      JSON.stringify({
        success: false,
        message: timedOut ? "Tempo esgotado ao buscar mídia no Drive." : "Falha ao transmitir mídia do Drive.",
      }),
      { status: timedOut ? 504 : 502, headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  }
}

import { normalizeText } from "../services/googleSheetsService";

/**
 * GET /api/media/audio
 * Proxy de streaming de áudio para links do Google Drive, com suporte a
 * HTTP Range (206) para seek instantâneo.
 */
export async function streamAudioController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const id = normalizeText(
    url.searchParams.get("id") || url.searchParams.get("file_id") || url.pathname.split("/").pop(),
  );

  if (!id) {
    return new Response(JSON.stringify({ success: false, message: "ID de áudio não informado." }), {
      status: 400,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  const match = id.match(/[-\w]{25,}/);
  const fileId = match ? match[0] : id;
  const driveDownloadUrl = `https://docs.google.com/uc?export=download&id=${fileId}`;

  try {
    const rangeHeader = request.headers.get("range");
    const proxyHeaders: Record<string, string> = {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    };
    if (rangeHeader) {
      proxyHeaders["Range"] = rangeHeader;
    }

    const driveRes = await fetch(driveDownloadUrl, { headers: proxyHeaders, redirect: "follow" });

    const contentType = driveRes.headers.get("content-type") || "";
    // Se a resposta for um stream de áudio ou binário válido
    if (driveRes.ok && !contentType.includes("text/html")) {
      const resHeaders = new Headers();
      resHeaders.set("Content-Type", contentType.includes("audio") ? contentType : "audio/mpeg");
      resHeaders.set("Access-Control-Allow-Origin", "*");
      resHeaders.set("Accept-Ranges", "bytes");

      if (driveRes.headers.has("content-length")) {
        resHeaders.set("Content-Length", driveRes.headers.get("content-length")!);
      }
      if (driveRes.headers.has("content-range")) {
        resHeaders.set("Content-Range", driveRes.headers.get("content-range")!);
      }

      return new Response(driveRes.body, {
        status: driveRes.status,
        headers: resHeaders,
      });
    }

    // Fallback para URL pública do Googleusercontent CDN
    const lh3Url = `https://lh3.googleusercontent.com/d/${fileId}`;
    return new Response(null, {
      status: 302,
      headers: {
        Location: lh3Url,
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (err) {
    console.error("[streamAudioController] Erro ao transmitir áudio:", err);
    return new Response(null, {
      status: 302,
      headers: {
        Location: `https://lh3.googleusercontent.com/d/${fileId}`,
        "Access-Control-Allow-Origin": "*",
      },
    });
  }
}

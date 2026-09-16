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

    // Sem retry nenhum aqui até 2026-09-16 — qualquer falha passageira da
    // API do Drive (rate limit, timeout de rede, 5xx momentâneo) já mostrava
    // "Não foi possível carregar o áudio" direto pro jogador, sem nenhuma
    // segunda chance. Num evento ao vivo com muita gente tocando música ao
    // mesmo tempo (mesma pressão que já causou os limites de cota do
    // Sheets hoje), isso é justamente quando picos passageiros são mais
    // prováveis — poucas tentativas com backoff curto cobrem exatamente
    // esse caso sem atrasar visivelmente quem não bateu em nada.
    const tentativas = 3;
    let driveRes: Response | undefined;
    let ultimoErro: unknown;
    for (let tentativa = 1; tentativa <= tentativas; tentativa++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20_000);
      try {
        driveRes = await fetch(
          `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
          { headers, signal: controller.signal },
        );
        ultimoErro = undefined;
        // 429 (rate limit) e 5xx são os únicos que valem retry — um 403
        // (sem permissão) ou 404 (arquivo não existe/foi apagado) nunca vão
        // se resolver tentando de novo.
        const vale_retry = driveRes.status === 429 || driveRes.status >= 500;
        if (driveRes.ok || !vale_retry || tentativa === tentativas) break;
      } catch (err) {
        ultimoErro = err;
        driveRes = undefined;
        if (tentativa === tentativas) break;
      } finally {
        clearTimeout(timeout);
      }
      await new Promise((resolve) => setTimeout(resolve, tentativa * 500));
    }

    if (!driveRes) throw ultimoErro instanceof Error ? ultimoErro : new Error(String(ultimoErro));

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

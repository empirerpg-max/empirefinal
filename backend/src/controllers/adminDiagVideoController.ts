import { googleSheetsService, normalizeText, normalizeComparison } from "../services/googleSheetsService";

// Diagnóstico read-only: dump cru da linha de "Music Videos" pra um título
// (busca substring) — usado pra investigar vídeos que não carregam
// ("Não foi possível carregar o vídeo") sem adivinhar qual coluna/fonte
// está errada.
//
// GET /api/empire-play/admin/diagnostico-video?titulo=...
export async function adminDiagVideoController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const titulo = normalizeText(url.searchParams.get("titulo") || "");
  const varredura = url.searchParams.get("varredura") === "1";

  const rows = await googleSheetsService.principal.readValues("Music Videos").catch(() => []);
  const headers = (rows[0] || []).map((h) => normalizeText(h));

  // ?varredura=1 — checa TODAS as linhas por link do Drive que aponta pra
  // uma PASTA (/drive/folders/...) em vez de um ARQUIVO (/file/d/...) —
  // link de pasta nunca é reproduzível, não importa o que o player faça.
  if (varredura) {
    const comProblema: Record<string, unknown>[] = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row) continue;
      const fonte = normalizeComparison(row[10] || "");
      const linkVideo = normalizeText(row[12] || "");
      if (fonte === "drive" && /\/drive\/folders\//i.test(linkVideo)) {
        comProblema.push({
          linha: i + 1,
          titulo: normalizeText(row[1]),
          linkDoVideo: linkVideo,
        });
      }
    }
    return new Response(JSON.stringify({ success: true, totalComLinkDePasta: comProblema.length, comProblema }, null, 2), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  if (!titulo) {
    return new Response(
      JSON.stringify({ success: false, error: "Use ?titulo=<nome do vídeo> ou ?varredura=1" }),
      { status: 400, headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  }

  const alvoNorm = normalizeComparison(titulo);
  const achadas: Record<string, unknown>[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    const rowText = row.join(" ");
    if (!normalizeComparison(rowText).includes(alvoNorm)) continue;
    const obj: Record<string, unknown> = { linha: i + 1 };
    headers.forEach((h, idx) => {
      obj[h || `coluna_${idx + 1}`] = row[idx] || "";
    });
    achadas.push(obj);
  }

  return new Response(JSON.stringify({ success: true, busca: titulo, headers, achadas }, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

import { googleSheetsService, normalizeText } from "../services/googleSheetsService";

// Diagnóstico read-only: dump da linha de Musicas por ID do tópico exato
// (coluna B) — usado quando a busca por título (adminDiagFaixaPendenteController)
// não encontra nada, pra confirmar se a linha existe mas com um título
// diferente do esperado (encoding, espaço, campo errado) ou se a linha
// realmente não existe na aba Musicas apesar do tópico funcionar.
//
// GET /api/empire-play/admin/diagnostico-musica-por-topico?topicId=...
export async function adminDiagMusicaPorTopicoController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const topicId = normalizeText(url.searchParams.get("topicId") || "");
  if (!topicId) {
    return new Response(JSON.stringify({ success: false, error: "Use ?topicId=<id>" }), {
      status: 400,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  const rows = await googleSheetsService.principal.readValues("Musicas", "A:AE").catch(() => []);
  let achada: Record<string, unknown> | null = null;
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    if (normalizeText(row[1]) === topicId || normalizeText(row[5]) === topicId) {
      achada = {
        linha: i + 1,
        data: row[0] || "",
        idDoTopico: row[1] || "",
        comentariosPara: row[5] || "",
        nome: row[7] || "",
        artistaPrincipal: row[13] || "",
        pendente: row[23] || "",
        codigoUnico: row[25] || "",
      };
      break;
    }
  }

  return new Response(
    JSON.stringify({ success: true, topicId, achada, totalLinhasMusicas: rows.length - 1 }, null, 2),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
}

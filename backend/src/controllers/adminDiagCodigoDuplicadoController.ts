import { googleSheetsService, normalizeText, normalizeComparison } from "../services/googleSheetsService";

// Diagnóstico read-only: dump de todas as linhas de "Musicas" cujo artista
// bate com o nome pedido, com o "Código único" (coluna Z) de cada uma —
// pra confirmar se duas faixas diferentes (ex: "Follia" e "Fuori Rotta")
// estão compartilhando o mesmo código único, o que faria o audit log de
// REGISTRO (que resolve o nome pelo código único, não pelo tópico
// comentado — ver registroLogController.buscarNomeCanonico) registrar o
// comentário de uma faixa debaixo do nome da outra.
//
// GET /api/empire-play/admin/diag-codigo-duplicado?artista=Max%20Gorghan
export async function adminDiagCodigoDuplicadoController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const artistaAlvo = normalizeComparison(url.searchParams.get("artista") || "");

  const musicasRows = await googleSheetsService.principal.readValues("Musicas", "A:AE").catch(() => []);
  const achadas: { linha: number; titulo: string; artista: string; codigoUnico: string; topicId: string }[] = [];
  for (let i = 1; i < musicasRows.length; i++) {
    const row = musicasRows[i];
    if (!row) continue;
    const artista = normalizeText(row[13]); // N - ACT PRINCIPAL
    const titulo = normalizeText(row[7]); // H - Nome da música
    if (artistaAlvo && !normalizeComparison(artista).includes(artistaAlvo) && !normalizeComparison(titulo).includes(artistaAlvo)) {
      continue;
    }
    achadas.push({
      linha: i + 1,
      titulo,
      artista,
      codigoUnico: normalizeText(row[25]), // Z
      topicId: normalizeText(row[1]), // B
    });
  }

  // Agrupa por código único pra expor na cara qualquer colisão.
  const porCodigo: Record<string, typeof achadas> = {};
  for (const item of achadas) {
    const key = item.codigoUnico || "(vazio)";
    if (!porCodigo[key]) porCodigo[key] = [];
    porCodigo[key].push(item);
  }
  const colisoes = Object.entries(porCodigo).filter(([key, items]) => key !== "(vazio)" && items.length > 1);

  return new Response(
    JSON.stringify({ success: true, total: achadas.length, achadas, colisoes: Object.fromEntries(colisoes) }, null, 2),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
}

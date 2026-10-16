import { googleSheetsService, normalizeText, normalizeComparison } from "../services/googleSheetsService";

// Diagnóstico read-only: por que uma faixa de álbum publicada via "Lançar
// Faixa de Álbum" (publicarFaixaPendenteController) não apareceu em
// EDIÇÃO CHARTS nem ganhou tópico — mostra a linha de Musicas, se bate com
// uma linha em EDIÇÃO CHARTS (mesma lógica de atualizarFaixaNosChartsAoPublicar,
// busca por "fullTitle" exato na coluna B) e a linha em REGISTRO/INFOS
// MÚSICAS se existir.
//
// GET /api/empire-play/admin/diagnostico-faixa-pendente?titulo=...
export async function adminDiagFaixaPendenteController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const titulo = normalizeText(url.searchParams.get("titulo") || "");
  if (!titulo) {
    return new Response(JSON.stringify({ success: false, error: "Use ?titulo=<nome da faixa>" }), {
      status: 400,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  const alvoNorm = normalizeComparison(titulo);
  const musicasRows = await googleSheetsService.principal.readValues("Musicas", "A:Z").catch(() => []);
  const linhasMusicas: Record<string, unknown>[] = [];
  for (let i = 1; i < musicasRows.length; i++) {
    const row = musicasRows[i];
    if (!row) continue;
    const nome = normalizeText(row[7]);
    if (!nome || !normalizeComparison(nome).includes(alvoNorm)) continue;
    linhasMusicas.push({
      linha: i + 1,
      data: row[0] || "",
      idDoTopico: row[1] || "",
      idDoArquivo: row[2] || "",
      comentariosPara: row[5] || "",
      nome,
      tipoSingle: row[8] || "",
      tipoMusica: row[9] || "",
      album: row[10] || "",
      artistaPrincipal: row[13] || "",
      ordem: row[20] || "",
      pendente: row[23] || "",
      codigoUnico: row[25] || "",
    });
  }

  const chartsRows = await googleSheetsService.edicaoCharts.readValues("EDIÇÃO CHARTS", "A:BD").catch(() => []);
  const linhasCharts: Record<string, unknown>[] = [];
  for (let i = 1; i < chartsRows.length; i++) {
    const row = chartsRows[i];
    if (!row) continue;
    const nome = normalizeText(row[1]); // B
    if (!nome || !normalizeComparison(nome).includes(alvoNorm)) continue;
    linhasCharts.push({
      linha: i + 1,
      titulo: nome,
      data: row[0] || "",
      tipoSingle: row[2] || "",
      tipoMusica: row[3] || "",
      codigoUnico: row[55] || "", // BD
    });
  }

  return new Response(
    JSON.stringify(
      {
        success: true,
        busca: titulo,
        musicas: linhasMusicas,
        edicaoCharts: linhasCharts,
      },
      null,
      2,
    ),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
}

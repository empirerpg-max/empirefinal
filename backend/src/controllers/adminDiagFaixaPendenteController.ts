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
  const codigoUnicoBusca = normalizeText(url.searchParams.get("codigoUnico") || "");
  if (!titulo && !codigoUnicoBusca) {
    return new Response(
      JSON.stringify({ success: false, error: "Use ?titulo=<nome da faixa> ou ?codigoUnico=<EMPxxx>" }),
      { status: 400, headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  }

  const alvoNorm = normalizeComparison(titulo);
  const musicasRows = await googleSheetsService.principal.readValues("Musicas", "A:AE").catch(() => []);
  const linhasMusicas: Record<string, unknown>[] = [];
  for (let i = 1; i < musicasRows.length; i++) {
    const row = musicasRows[i];
    if (!row) continue;
    const nome = normalizeText(row[7]);
    const codigo = normalizeText(row[25]);
    const bateTitulo = titulo && nome && normalizeComparison(nome).includes(alvoNorm);
    const bateCodigo = codigoUnicoBusca && codigo === codigoUnicoBusca;
    if (!bateTitulo && !bateCodigo) continue;
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

  const registroRows = await googleSheetsService.registrosCharts
    .readValues("REGISTRO DE MÚSICA")
    .catch(() => []);
  const linhasRegistro: Record<string, unknown>[] = [];
  for (let i = 1; i < registroRows.length; i++) {
    const row = registroRows[i];
    if (!row) continue;
    const nome = normalizeText(row[1]); // B
    if (!nome || !normalizeComparison(nome).includes(alvoNorm)) continue;
    linhasRegistro.push({ linha: i + 1, titulo: nome, tipoSingle: row[2] || "", tipoMusica: row[3] || "" });
  }

  const infosRows = await googleSheetsService.registrosCharts
    .readValues("INFOS MÚSICAS")
    .catch(() => []);
  const linhasInfos: Record<string, unknown>[] = [];
  for (let i = 1; i < infosRows.length; i++) {
    const row = infosRows[i];
    if (!row) continue;
    const nome = normalizeText(row[0]); // A
    if (!nome || !normalizeComparison(nome).includes(alvoNorm)) continue;
    linhasInfos.push({ linha: i + 1, titulo: nome, capaD: row[3] || "", capaG: row[6] || "" });
  }

  const comentariosRows = await googleSheetsService.principal
    .readValues("Comentarios_Musicas")
    .catch(() => []);
  const linhasComentarios: Record<string, unknown>[] = [];
  for (let i = 1; i < comentariosRows.length; i++) {
    const row = comentariosRows[i];
    if (!row) continue;
    const comentariosPara = normalizeText(row[0] || "");
    const nomeJogador = normalizeText(row[2] || "");
    if (
      !comentariosPara.toLowerCase().includes("1792252409065") &&
      !nomeJogador.toLowerCase().includes("daniel")
    )
      continue;
    linhasComentarios.push({ linha: i + 1, row });
  }

  return new Response(
    JSON.stringify(
      {
        success: true,
        busca: titulo,
        musicas: linhasMusicas,
        edicaoCharts: linhasCharts,
        registroDeMusica: linhasRegistro,
        infosMusicas: linhasInfos,
        comentariosSuspeitos: linhasComentarios,
      },
      null,
      2,
    ),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
}

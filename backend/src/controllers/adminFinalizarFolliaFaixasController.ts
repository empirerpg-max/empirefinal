import {
  googleSheetsService,
  normalizeText,
  normalizeComparison,
  updateValuesBatch,
} from "../services/googleSheetsService";
import {
  registrarNaEdicaoCharts,
  lerCodigoUnicoGerado,
  mirrorMusicaRowParaD1,
} from "./gestaoController";

// Completa o que adminRecuperarFolliaFaixasController deixou faltando: ele
// gravou as 9 faixas reais direto em "Musicas" (bypass intencional do
// appendRow quebrado), mas pulou o resto do fluxo normal de
// processarFaixasDoAlbum — registro em "EDIÇÃO CHARTS" (dado que
// alimenta vendas/streams do chart), Código único (coluna Z de Musicas,
// usado por comentários/REGISTRO/Shop-Info-Visual) e o espelho real no
// D1 `musicas` (distinto do `midia` já confirmado limpo).
//
// Idempotente: pra cada faixa, só cria a linha em EDIÇÃO CHARTS se ainda
// não existir uma com o mesmo título+álbum.
//
// ?dryRun=1 só mostra o plano.
// GET /api/empire-play/admin/finalizar-follia-faixas?dryRun=1
export async function adminFinalizarFolliaFaixasController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const dryRun = url.searchParams.get("dryRun") === "1";

  const ALBUM_TITULO = "Max Gorghan - FOLLIA";

  // Acha as 9 faixas já gravadas certas em Musicas (título+álbum numa
  // linha começando de verdade na coluna A — mesmo critério usado na
  // recuperação).
  const musicasRows = await googleSheetsService.principal.readValues("Musicas", "A1:AE1000").catch(() => []);
  const faixas: { linha: number; titulo: string; tipoSingle: string; tipoMusica: string; artistaPrincipal: string; participantes: string[]; codigoAtual: string }[] = [];
  for (let i = 1; i < musicasRows.length; i++) {
    const row = musicasRows[i];
    if (!row) continue;
    const titulo = normalizeText(row[7]);
    const album = normalizeText(row[10]);
    if (!titulo || normalizeComparison(album) !== normalizeComparison(ALBUM_TITULO)) continue;
    faixas.push({
      linha: i + 1,
      titulo,
      tipoSingle: normalizeText(row[8]) || "TRACKLIST ALBUM",
      tipoMusica: normalizeText(row[9]) || "SOLO",
      artistaPrincipal: normalizeText(row[13]),
      participantes: [row[14], row[15], row[16], row[17], row[18]].map((v) => normalizeText(v)).filter(Boolean),
      codigoAtual: normalizeText(row[25]),
    });
  }

  const edicaoChartsRows = await googleSheetsService.edicaoCharts.readValues("EDIÇÃO CHARTS", "A2:E20000").catch(() => []);
  const jaRegistradas = new Set<string>();
  // Pedido explícito do usuário: checar duplicata REAL (mais de 1 linha
  // pro mesmo título+álbum), não só presença — EDIÇÃO CHARTS usa escrita
  // segura (nunca teve o bug de deslocamento), mas nada impedia duas
  // rodadas de processarFaixasDoAlbum (ex: a original quebrada + uma
  // futura tentativa manual) de registrar a mesma faixa duas vezes.
  const linhasPorTitulo = new Map<string, number[]>();
  for (let i = 0; i < edicaoChartsRows.length; i++) {
    const row = edicaoChartsRows[i];
    const titulo = normalizeComparison(normalizeText(row?.[1]));
    const album = normalizeComparison(normalizeText(row?.[4]));
    if (!titulo || album !== normalizeComparison(ALBUM_TITULO)) continue;
    jaRegistradas.add(titulo);
    const linha = i + 2; // A2 é a linha 2
    if (!linhasPorTitulo.has(titulo)) linhasPorTitulo.set(titulo, []);
    linhasPorTitulo.get(titulo)!.push(linha);
  }
  const edicaoChartsDuplicadas: { titulo: string; linhas: number[]; linhasParaLimpar: number[] }[] = [];
  for (const [titulo, linhas] of linhasPorTitulo) {
    if (linhas.length > 1) {
      edicaoChartsDuplicadas.push({ titulo, linhas, linhasParaLimpar: linhas.slice(1) }); // mantém a 1ª, limpa o resto
    }
  }

  // Mesma checagem em EDIÇÃO CHARTS ÁLBUMS pro álbum FOLLIA (já limpo
  // antes, mas confirma em vez de assumir).
  const edicaoChartsAlbunsRows = await googleSheetsService.edicaoCharts
    .readValues("EDIÇÃO CHARTS ÁLBUMS", "A2:D20000")
    .catch(() => []);
  const linhasAlbumPorNome: number[] = [];
  for (let i = 0; i < edicaoChartsAlbunsRows.length; i++) {
    const nome = normalizeComparison(normalizeText(edicaoChartsAlbunsRows[i]?.[3]));
    if (nome === normalizeComparison(ALBUM_TITULO)) linhasAlbumPorNome.push(i + 2);
  }

  const pendentes = faixas.filter((f) => !f.codigoAtual || !jaRegistradas.has(normalizeComparison(f.titulo)));

  if (dryRun) {
    return new Response(
      JSON.stringify(
        {
          success: true,
          dryRun: true,
          totalFaixasEncontradas: faixas.length,
          faixasComCodigo: faixas.filter((f) => f.codigoAtual).length,
          faixasJaRegistradasEmEdicaoCharts: faixas.filter((f) => jaRegistradas.has(normalizeComparison(f.titulo))).length,
          pendentes: pendentes.map((f) => ({ linha: f.linha, titulo: f.titulo, temCodigo: !!f.codigoAtual })),
          edicaoChartsDuplicadas,
          albunsFolliaEmEdicaoChartsAlbuns: linhasAlbumPorNome,
        },
        null,
        2,
      ),
      { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  }

  // Limpa duplicata REAL em EDIÇÃO CHARTS (mantém a 1ª ocorrência de cada
  // título, esvazia o resto) — nunca exclui linha, só esvazia (regra do
  // usuário pra qualquer limpeza de planilha nesta sessão). Em lote
  // (values:batchUpdate, uma chamada de rede só) — N chamadas sequenciais
  // de updateValues estouravam a cota de escrita por minuto do Sheets
  // bem antes de terminar (confirmado ao vivo nesta mesma sessão).
  const linhasEdicaoChartsParaLimpar = edicaoChartsDuplicadas.flatMap((dup) => dup.linhasParaLimpar);
  let edicaoChartsDupOk = 0;
  let edicaoChartsDupFalha = 0;
  const LOTE_BATCH = 80;
  for (let i = 0; i < linhasEdicaoChartsParaLimpar.length; i += LOTE_BATCH) {
    const lote = linhasEdicaoChartsParaLimpar.slice(i, i + LOTE_BATCH);
    const entries = lote.map((linha) => ({
      sheetName: "EDIÇÃO CHARTS",
      range: `A${linha}:Q${linha}`,
      values: [Array(17).fill("")],
    }));
    const sucesso = await updateValuesBatch("edicaoCharts", entries);
    if (sucesso) edicaoChartsDupOk += lote.length;
    else edicaoChartsDupFalha += lote.length;
  }

  // EDIÇÃO CHARTS ÁLBUMS: se sobrou mais de 1 linha pro FOLLIA (não
  // deveria, já limpo antes), mantém a 1ª e esvazia o resto — mesmo
  // padrão em lote.
  const linhasAlbunsParaLimpar = linhasAlbumPorNome.slice(1);
  let albunsDupOk = 0;
  let albunsDupFalha = 0;
  for (let i = 0; i < linhasAlbunsParaLimpar.length; i += LOTE_BATCH) {
    const lote = linhasAlbunsParaLimpar.slice(i, i + LOTE_BATCH);
    const entries = lote.map((linha) => ({
      sheetName: "EDIÇÃO CHARTS ÁLBUMS",
      range: `A${linha}:R${linha}`,
      values: [Array(18).fill("")],
    }));
    const sucesso = await updateValuesBatch("edicaoCharts", entries);
    if (sucesso) albunsDupOk += lote.length;
    else albunsDupFalha += lote.length;
  }

  const resultado: { titulo: string; edicaoChartsRowIndex: number | null; codigo: string; d1Ok: boolean }[] = [];
  for (const f of pendentes) {
    let codigo = f.codigoAtual;
    let edicaoChartsRowIndex: number | null = null;

    if (!jaRegistradas.has(normalizeComparison(f.titulo))) {
      edicaoChartsRowIndex = await registrarNaEdicaoCharts({
        dataFormatada: "21/10/2026",
        fullTitle: f.titulo,
        tipoSingle: f.tipoSingle,
        tipoMusica: f.tipoMusica,
        album: ALBUM_TITULO,
        artistaPrincipal: f.artistaPrincipal,
        participantes: f.participantes,
      });
      if (edicaoChartsRowIndex) {
        codigo = await lerCodigoUnicoGerado(edicaoChartsRowIndex);
      }
    } else if (!codigo) {
      // BUG REAL confirmado: já existia uma linha em EDIÇÃO CHARTS (a
      // mantida após a dedup acima), então pulava registrarNaEdicaoCharts
      // certo — mas aí nunca buscava o Código único dessa linha JÁ
      // existente pra copiar em Musicas!Z, deixando a faixa sem código
      // mesmo com a linha do chart presente. Usa a 1ª linha mantida
      // (linhasPorTitulo, calculado antes da dedup) pra ler o código.
      const linhaMantida = linhasPorTitulo.get(normalizeComparison(f.titulo))?.[0];
      if (linhaMantida) {
        edicaoChartsRowIndex = linhaMantida;
        codigo = await lerCodigoUnicoGerado(linhaMantida);
      }
    }

    if (codigo && !f.codigoAtual) {
      await googleSheetsService.principal.updateValues("Musicas", `Z${f.linha}`, [[codigo]]).catch(() => {});
    }

    const d1Ok = await mirrorMusicaRowParaD1(f.linha)
      .then(() => true)
      .catch(() => false);

    resultado.push({ titulo: f.titulo, edicaoChartsRowIndex, codigo, d1Ok });
    await new Promise((resolve) => setTimeout(resolve, 400));
  }

  // Confirma coerência final do Código único nas 9 faixas: cada uma
  // precisa ter um código, e nenhum pode se repetir entre elas (duas
  // faixas nunca podem compartilhar o mesmo Código único).
  const musicasAposRows = await googleSheetsService.principal.readValues("Musicas", "H1:Z1000").catch(() => []);
  const codigosPorTitulo: Record<string, string> = {};
  for (const f of faixas) {
    const row = musicasAposRows[f.linha - 1];
    codigosPorTitulo[f.titulo] = normalizeText(row?.[18]); // Z relativo a H (índice 25-7=18)
  }
  const codigosVistos = new Map<string, string[]>();
  for (const [titulo, codigo] of Object.entries(codigosPorTitulo)) {
    if (!codigo) continue;
    if (!codigosVistos.has(codigo)) codigosVistos.set(codigo, []);
    codigosVistos.get(codigo)!.push(titulo);
  }
  const codigosDuplicados = [...codigosVistos.entries()].filter(([, titulos]) => titulos.length > 1);

  return new Response(
    JSON.stringify(
      {
        success: true,
        dryRun: false,
        resultado,
        edicaoChartsDuplicadasLimpas: { ok: edicaoChartsDupOk, falha: edicaoChartsDupFalha },
        albunsDuplicadosLimpos: { ok: albunsDupOk, falha: albunsDupFalha },
        verificacaoCodigoUnico: {
          codigosPorTitulo,
          codigosDuplicados,
          todasTemCodigo: Object.values(codigosPorTitulo).every(Boolean),
        },
      },
      null,
      2,
    ),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
}

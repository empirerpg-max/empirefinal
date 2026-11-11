import { googleSheetsService, normalizeComparison } from "../services/googleSheetsService";
import { vincularFaixaExistenteAoAlbum } from "./gestaoController";
import { registrarLogSistema } from "../services/logSistemaService";
import { getCatalogoDb } from "../services/catalogoDbService";

// Fix pontual (2026-11-11): ao relançar as faixas faltantes do álbum
// "Samantha Cooper - WELL, IT'S OVER" (ver
// adminRelancarFaixasFaltantesPreSaveController), a faixa #9 "IT'S OVER"
// estava marcada como INÉDITA na campanha de pre-save, mas na verdade já
// existia no catálogo havia dias como single "PRÉ-ALBUM" (Código único
// EMP999, Musicas linha 831) — reportado pelo usuário. Como inédita, o
// relançamento criou uma linha NOVA em Musicas (linha 846, Código único
// EMP1005) em vez de vincular a existente, duplicando a música inteira
// (2 linhas em Musicas, 2 entradas em EDIÇÃO CHARTS pro mesmo título).
//
// Fix: apaga a linha duplicada (EMP1005) de Musicas + EDIÇÃO CHARTS +
// REGISTRO DE MÚSICA + D1, e vincula a faixa existente de verdade (EMP999)
// ao álbum via vincularFaixaExistenteAoAlbum (mesmo caminho usado por
// "CURSED BLESSED"/"FUCKED UP", as outras 2 faixas não-inéditas desse
// mesmo álbum).
//
// GET /api/gestao/admin/fix-duplicata-its-over?confirmar=1
export async function adminFixDuplicataItsOverController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const confirmar = url.searchParams.get("confirmar") === "1";

  const CODIGO_DUPLICADO = "EMP1005";
  const CODIGO_ORIGINAL = "EMP999";
  const ALBUM_FULL_TITLE = "Samantha Cooper - WELL, IT’S OVER";
  const TITULO_MUSICA = "Samantha Cooper - IT’S OVER";
  const ARTISTA = "Samantha Cooper";
  const JOGADOR_ID = "";
  const DATA_FORMATADA = "11/11/2026";
  const ORDEM = 9;

  const musicasRows = await googleSheetsService.principal.readValues("Musicas", "A:Z").catch(() => []);
  const linhaDuplicada = musicasRows.findIndex(
    (row, i) => i > 0 && normalizeComparison(row[25] || "") === normalizeComparison(CODIGO_DUPLICADO),
  );
  const linhaOriginal = musicasRows.findIndex(
    (row, i) => i > 0 && normalizeComparison(row[25] || "") === normalizeComparison(CODIGO_ORIGINAL),
  );

  if (linhaDuplicada === -1 || linhaOriginal === -1) {
    return new Response(
      JSON.stringify({
        success: false,
        error: `Não encontrei as 2 linhas esperadas em Musicas (duplicada=${linhaDuplicada + 1}, original=${linhaOriginal + 1}).`,
      }),
      { status: 404, headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  }

  const edicaoChartsRows = await googleSheetsService.edicaoCharts
    .readValues("EDIÇÃO CHARTS", "B2:BD20000")
    .catch(() => []);
  const edicaoChartsLinhaDuplicada = edicaoChartsRows.findIndex(
    (row) => normalizeComparison(row?.[54] || "") === normalizeComparison(CODIGO_DUPLICADO),
  );

  const registroRows = await googleSheetsService.registrosCharts
    .readValues("REGISTRO DE MÚSICA")
    .catch(() => []);
  const registroLinhaDuplicada = registroRows.findIndex(
    (row, i) =>
      i > 0 &&
      normalizeComparison(row[1] || "") === normalizeComparison(TITULO_MUSICA) &&
      normalizeComparison(row[4] || "") === normalizeComparison(ALBUM_FULL_TITLE),
  );

  const plano = {
    musicasLinhaDuplicada: linhaDuplicada + 1,
    musicasLinhaOriginal: linhaOriginal + 1,
    edicaoChartsLinhaDuplicada: edicaoChartsLinhaDuplicada >= 0 ? edicaoChartsLinhaDuplicada + 2 : null,
    registroLinhaDuplicada: registroLinhaDuplicada >= 0 ? registroLinhaDuplicada + 1 : null,
  };

  if (!confirmar) {
    return new Response(
      JSON.stringify({
        success: true,
        dryRun: true,
        plano,
        aviso: "Dry-run — nada foi gravado. Repita com &confirmar=1 pra aplicar.",
      }, null, 2),
      { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  }

  const acoes: string[] = [];

  // 1. Apaga a linha duplicada em Musicas (A:Z em branco).
  await googleSheetsService.principal.updateValues(
    "Musicas",
    `A${plano.musicasLinhaDuplicada}:Z${plano.musicasLinhaDuplicada}`,
    [new Array(26).fill("")],
  );
  acoes.push(`Musicas linha ${plano.musicasLinhaDuplicada} (${CODIGO_DUPLICADO}) apagada.`);

  // 2. Apaga a entrada duplicada em EDIÇÃO CHARTS.
  if (plano.edicaoChartsLinhaDuplicada) {
    await googleSheetsService.edicaoCharts.updateValues(
      "EDIÇÃO CHARTS",
      `B${plano.edicaoChartsLinhaDuplicada}:BD${plano.edicaoChartsLinhaDuplicada}`,
      [new Array(55).fill("")],
    );
    acoes.push(`EDIÇÃO CHARTS linha ${plano.edicaoChartsLinhaDuplicada} apagada.`);
  }

  // 3. Apaga o registro duplicado em REGISTRO DE MÚSICA (nunca processado
  // pro chart de verdade, mas podia ser lido num próximo ciclo e contar
  // pontos pra um código único que não deveria mais existir).
  if (plano.registroLinhaDuplicada) {
    await googleSheetsService.registrosCharts.updateValues(
      "REGISTRO DE MÚSICA",
      `B${plano.registroLinhaDuplicada}:P${plano.registroLinhaDuplicada}`,
      [new Array(15).fill("")],
    );
    acoes.push(`REGISTRO DE MÚSICA linha ${plano.registroLinhaDuplicada} apagada.`);
  }

  // 4. Best-effort: remove a linha espelhada no D1 (musicas) pro código
  // duplicado.
  try {
    const db = getCatalogoDb();
    if (db) {
      await db.prepare("DELETE FROM musicas WHERE codigo_unico = ?").bind(CODIGO_DUPLICADO).run();
      acoes.push(`D1 musicas (${CODIGO_DUPLICADO}) removido.`);
    }
  } catch (err) {
    console.warn("[adminFixDuplicataItsOverController] Falha ao limpar D1:", err);
  }

  // 5. Vincula a faixa EXISTENTE de verdade (EMP999) ao álbum — mesmo
  // caminho usado por "CURSED BLESSED"/"FUCKED UP" nesse mesmo álbum.
  const resultadoVinculo = await vincularFaixaExistenteAoAlbum(
    TITULO_MUSICA,
    ALBUM_FULL_TITLE,
    ORDEM,
    ARTISTA,
    JOGADOR_ID,
    DATA_FORMATADA,
  );
  acoes.push(`Vinculada "${TITULO_MUSICA}" (${CODIGO_ORIGINAL}) ao álbum, ordem ${ORDEM}: ${JSON.stringify(resultadoVinculo)}`);

  registrarLogSistema({
    categoria: "Ação concluída",
    oQueAconteceu: `[admin fix] Removida duplicata de "IT'S OVER" (${CODIGO_DUPLICADO}) criada ao relançar faixas faltantes do álbum "${ALBUM_FULL_TITLE}" — faixa já existia como single PRÉ-ALBUM (${CODIGO_ORIGINAL}) e foi vinculada ao álbum corretamente, sem duplicar.`,
    onde: "adminFixDuplicataItsOverController",
  }).catch(() => {});

  return new Response(JSON.stringify({ success: true, acoes, resultadoVinculo }, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

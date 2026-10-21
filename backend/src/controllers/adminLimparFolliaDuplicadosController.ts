import { getCatalogoDb } from "../services/musicasDbService";
import { googleSheetsService, normalizeText, normalizeComparison } from "../services/googleSheetsService";

// Fix definitivo do incidente FOLLIA (Max Gorghan): o bug de lançamento
// duplicado (ver adminStopFolliaPresaveController + fix de
// writeMissoesCampanha) gerou 53 cópias do mesmo álbum em "Albuns", cada
// uma com sua própria leva de faixas em "Musicas" e sua própria linha em
// "EDIÇÃO CHARTS ÁLBUMS". Usuário pediu explicitamente: manter só 1
// álbum (o PRINCIPAL — o mais antigo, com as infos originais que o
// jogador cadastrou) e limpar o resto.
//
// Regra do usuário (vale pra qualquer limpeza de planilha nesta sessão):
// NUNCA excluir linha (:batchUpdate deleteDimension desloca todas as
// linhas seguintes) — sempre ESVAZIAR as células, preservando a posição
// da linha. Vale pra "Albuns", "EDIÇÃO CHARTS ÁLBUMS" e "Musicas". D1 é
// só espelho best-effort (nunca fonte de verdade, ver catalogoDbService)
// — ali sim dá pra apagar a linha de vez (PK é codigo_unico, não existe
// posição a preservar).
//
// ?dryRun=1 só mostra o que seria feito, sem gravar nada.
// GET /api/empire-play/admin/limpar-follia-duplicados?dryRun=1
export async function adminLimparFolliaDuplicadosController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const dryRun = url.searchParams.get("dryRun") === "1";

  const albunsRows = await googleSheetsService.principal.readValues("Albuns", "A1:Z20000").catch(() => []);
  const albuns: { linha: number; topicId: string; criadoEmMs: number; codigoUnico: string }[] = [];
  for (let i = 1; i < albunsRows.length; i++) {
    const row = albunsRows[i];
    if (!row) continue;
    if (normalizeComparison(normalizeText(row[6])) !== normalizeComparison("Max Gorghan - Follia")) continue;
    const topicId = normalizeText(row[1]);
    const match = /^album_(\d+)_/.exec(topicId);
    albuns.push({
      linha: i + 1,
      topicId,
      criadoEmMs: match ? Number(match[1]) : 0,
      codigoUnico: normalizeText(row[11]), // L
    });
  }
  albuns.sort((a, b) => a.criadoEmMs - b.criadoEmMs);

  if (albuns.length <= 1) {
    return new Response(
      JSON.stringify({ success: true, aviso: "0 ou 1 álbum FOLLIA encontrado — nada pra limpar.", albuns }, null, 2),
      { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  }

  const principal = albuns[0];
  const duplicados = albuns.slice(1);

  const musicasRows = await googleSheetsService.principal.readValues("Musicas", "A1:AE20000").catch(() => []);
  const faixasFollia: { linha: number; trackTopicId: string; titulo: string; criadoEmMs: number }[] = [];
  for (let i = 1; i < musicasRows.length; i++) {
    const row = musicasRows[i];
    if (!row) continue;
    if (normalizeComparison(normalizeText(row[10])) !== normalizeComparison("Max Gorghan - Follia")) continue;
    const trackTopicId = normalizeText(row[1]);
    const match = /^musica_(\d+)_/.exec(trackTopicId);
    faixasFollia.push({
      linha: i + 1,
      trackTopicId,
      titulo: normalizeText(row[7]),
      criadoEmMs: match ? Number(match[1]) : 0,
    });
  }

  const gruposAlbum = albuns.map((a) => ({ ...a, faixas: [] as typeof faixasFollia }));
  for (const f of faixasFollia) {
    let melhor = -1;
    let melhorDist = Infinity;
    for (let i = 0; i < gruposAlbum.length; i++) {
      const dist = f.criadoEmMs - gruposAlbum[i].criadoEmMs;
      if (dist >= -2000 && dist < melhorDist) {
        melhorDist = dist;
        melhor = i;
      }
    }
    if (melhor >= 0) gruposAlbum[melhor].faixas.push(f);
  }
  const faixasParaLimpar = gruposAlbum.slice(1).flatMap((g) => g.faixas);
  const faixasDoPrincipal = gruposAlbum[0].faixas;

  const edicaoChartsRows = await googleSheetsService.edicaoCharts
    .readValues("EDIÇÃO CHARTS ÁLBUMS", "A1:R20000")
    .catch(() => []);
  const edicaoChartsPorCodigo: Record<string, number> = {};
  for (let i = 1; i < edicaoChartsRows.length; i++) {
    const row = edicaoChartsRows[i];
    if (!row) continue;
    const codigo = normalizeText(row[17]);
    if (codigo) edicaoChartsPorCodigo[codigo] = i + 1;
  }
  const linhasEdicaoChartsParaLimpar = duplicados
    .map((d) => (d.codigoUnico ? edicaoChartsPorCodigo[d.codigoUnico] : null))
    .filter((n): n is number => !!n);

  const resumo = {
    principal: { linha: principal.linha, topicId: principal.topicId, codigoUnico: principal.codigoUnico, numFaixas: faixasDoPrincipal.length },
    albunsParaLimpar: duplicados.map((d) => d.linha),
    edicaoChartsAlbunsParaLimpar: linhasEdicaoChartsParaLimpar,
    faixasParaLimpar: faixasParaLimpar.map((f) => f.linha),
    totalAlbunsLimpos: duplicados.length,
    totalFaixasLimpas: faixasParaLimpar.length,
    totalEdicaoChartsAlbunsLimpos: linhasEdicaoChartsParaLimpar.length,
  };

  if (dryRun) {
    return new Response(
      JSON.stringify({ success: true, dryRun: true, ...resumo }, null, 2),
      { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  }

  // BUG REAL confirmado em produção: a primeira rodada desse fix fez 100+
  // chamadas de updateValues seguidas sem pausa nenhuma, estourou a cota
  // de escrita por minuto da API do Sheets no meio do caminho — as
  // últimas chamadas falharam (429), foram engolidas pelo .catch() e o
  // endpoint reportou sucesso mesmo assim (resumo "planejado", nunca
  // verificado). Fix: pausa entre cada escrita + 1 retry com backoff +
  // contadores de sucesso/falha REAIS no retorno, em vez de confiar que
  // o plano = o que realmente foi gravado.
  // IMPORTANTE: updateValues (googleSheetsService.ts) NUNCA lança exceção
  // — ela já tem seu próprio retry (3x) por dentro e, se todas falharem,
  // só RETORNA false. Um try/catch em volta dela nunca pega nada; é
  // preciso checar o valor booleano de retorno pra saber se a escrita
  // realmente aconteceu (bug real: a primeira versão deste helper usava
  // só try/catch, sempre devolvia true, e os contadores de sucesso
  // reportados eram mentira).
  const dormir = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  async function escreverComRetry(fn: () => Promise<boolean>, label: string): Promise<boolean> {
    for (let tentativa = 0; tentativa < 2; tentativa++) {
      try {
        const sucesso = await fn();
        if (sucesso) return true;
        console.warn(`[adminLimparFolliaDuplicados] updateValues retornou false ao ${label} (tentativa ${tentativa + 1})`);
      } catch (err) {
        console.warn(`[adminLimparFolliaDuplicados] Falha ao ${label} (tentativa ${tentativa + 1}):`, err);
      }
      if (tentativa === 0) await dormir(1500);
    }
    return false;
  }

  let albunsOk = 0;
  let albunsFalha = 0;
  // A:L (12 colunas) — NÃO só A:K. Coluna L (Código único) é copiada à
  // parte por registrarAlbumNaEdicaoChartsAlbuns (gestaoController.ts) e
  // fica fora do range A:K que publicarAlbum escreve. Bug real: a
  // primeira versão esvaziava só A:K, deixando L preenchida — a linha
  // deixava de ficar 100% vazia e readSheetObjects parava de filtrá-la,
  // virando um álbum "fantasma" sem título/capa (fallback "Álbum N") no
  // Fórum > Álbuns. Ver adminFixFolliaColunaLController (fix retroativo
  // pras linhas já esvaziadas erradas antes deste fix).
  const ALBUNS_VAZIO = Array(12).fill("");
  for (const d of duplicados) {
    const ok = await escreverComRetry(
      () => googleSheetsService.principal.updateValues("Albuns", `A${d.linha}:L${d.linha}`, [ALBUNS_VAZIO]),
      `esvaziar Albuns linha ${d.linha}`,
    );
    if (ok) albunsOk++;
    else albunsFalha++;
    await dormir(400);
  }

  let edicaoChartsOk = 0;
  let edicaoChartsFalha = 0;
  const EDICAO_CHARTS_ALBUNS_VAZIO = Array(18).fill("");
  for (const linha of linhasEdicaoChartsParaLimpar) {
    const ok = await escreverComRetry(
      () => googleSheetsService.edicaoCharts.updateValues("EDIÇÃO CHARTS ÁLBUMS", `A${linha}:R${linha}`, [EDICAO_CHARTS_ALBUNS_VAZIO]),
      `esvaziar EDIÇÃO CHARTS ÁLBUMS linha ${linha}`,
    );
    if (ok) edicaoChartsOk++;
    else edicaoChartsFalha++;
    await dormir(400);
  }

  let faixasOk = 0;
  let faixasFalha = 0;
  const MUSICAS_VAZIO = Array(24).fill("");
  for (const f of faixasParaLimpar) {
    const ok = await escreverComRetry(
      () => googleSheetsService.principal.updateValues("Musicas", `A${f.linha}:X${f.linha}`, [MUSICAS_VAZIO]),
      `esvaziar Musicas linha ${f.linha}`,
    );
    if (ok) faixasOk++;
    else faixasFalha++;
    await dormir(400);
  }

  // D1 é só espelho best-effort — apaga de vez (PK codigo_unico/id, sem
  // posição pra preservar).
  const db = getCatalogoDb();
  if (db) {
    for (const d of duplicados) {
      await db.prepare("DELETE FROM midia WHERE id = ?").bind(d.topicId).run().catch(() => {});
    }
    for (const f of faixasParaLimpar) {
      await db.prepare("DELETE FROM midia WHERE id = ?").bind(f.trackTopicId).run().catch(() => {});
    }
  }

  return new Response(
    JSON.stringify(
      {
        success: true,
        dryRun: false,
        ...resumo,
        resultadoReal: { albunsOk, albunsFalha, edicaoChartsOk, edicaoChartsFalha, faixasOk, faixasFalha },
      },
      null,
      2,
    ),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
}

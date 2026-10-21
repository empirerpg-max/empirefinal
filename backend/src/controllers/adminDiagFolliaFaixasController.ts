import { googleSheetsService, normalizeText, normalizeComparison } from "../services/googleSheetsService";

// Mapeia TUDO que cada um dos 53 lançamentos duplicados do álbum FOLLIA
// (Max Gorghan) gerou, pra decidir com segurança o que manter (o
// "principal", linha 101/mais antigo) e o que limpar. Cada chamada de
// publicarAlbum cria: 1 linha em "Albuns", 1 linha em
// "EDIÇÃO CHARTS ÁLBUMS" (linkada via Código único, copiado pra
// Albuns!L), e N linhas NOVAS em "Musicas" (uma por faixa, cada uma com
// seu próprio "ID do tópico" novo — não tem FK direta pro álbum, então
// correlaciona pelo timestamp embutido no topicId, que fica a poucos ms
// do timestamp do álbum da mesma leva) + as respectivas linhas em
// "EDIÇÃO CHARTS" dessas faixas.
//
// GET /api/empire-play/admin/diagnostico-follia-faixas
export async function adminDiagFolliaFaixasController(): Promise<Response> {
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

  const musicasRows = await googleSheetsService.principal.readValues("Musicas", "A1:AE20000").catch(() => []);
  const faixasFollia: { linha: number; trackTopicId: string; titulo: string; criadoEmMs: number }[] = [];
  for (let i = 1; i < musicasRows.length; i++) {
    const row = musicasRows[i];
    if (!row) continue;
    const album = normalizeText(row[10]); // K
    if (normalizeComparison(album) !== normalizeComparison("Max Gorghan - Follia")) continue;
    const trackTopicId = normalizeText(row[1]); // B
    const match = /^musica_(\d+)_/.exec(trackTopicId);
    faixasFollia.push({
      linha: i + 1,
      trackTopicId,
      titulo: normalizeText(row[7]), // H
      criadoEmMs: match ? Number(match[1]) : 0,
    });
  }

  // Agrupa cada faixa no álbum cujo criadoEmMs é o mais próximo (faixas
  // de uma leva nascem poucos ms DEPOIS do álbum, nunca antes).
  const grupos = albuns.map((a) => ({ ...a, faixas: [] as typeof faixasFollia }));
  for (const f of faixasFollia) {
    let melhor = -1;
    let melhorDist = Infinity;
    for (let i = 0; i < grupos.length; i++) {
      const dist = f.criadoEmMs - grupos[i].criadoEmMs;
      if (dist >= -2000 && dist < melhorDist) {
        melhorDist = dist;
        melhor = i;
      }
    }
    if (melhor >= 0) grupos[melhor].faixas.push(f);
  }

  const edicaoChartsRows = await googleSheetsService.edicaoCharts
    .readValues("EDIÇÃO CHARTS ÁLBUMS", "A1:R20000")
    .catch(() => []);
  const edicaoChartsPorCodigo: Record<string, number> = {};
  for (let i = 1; i < edicaoChartsRows.length; i++) {
    const row = edicaoChartsRows[i];
    if (!row) continue;
    const codigo = normalizeText(row[17]); // R
    if (codigo) edicaoChartsPorCodigo[codigo] = i + 1;
  }

  const resumo = grupos.map((g) => ({
    linhaAlbuns: g.linha,
    topicId: g.topicId,
    criadoEm: g.criadoEmMs ? new Date(g.criadoEmMs).toISOString() : null,
    codigoUnico: g.codigoUnico,
    linhaEdicaoChartsAlbuns: g.codigoUnico ? edicaoChartsPorCodigo[g.codigoUnico] || null : null,
    numFaixas: g.faixas.length,
    faixas: g.faixas.map((f) => ({ linha: f.linha, titulo: f.titulo, trackTopicId: f.trackTopicId })),
  }));

  return new Response(
    JSON.stringify(
      {
        success: true,
        totalAlbuns: albuns.length,
        totalFaixasFollia: faixasFollia.length,
        resumo,
      },
      null,
      2,
    ),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
}

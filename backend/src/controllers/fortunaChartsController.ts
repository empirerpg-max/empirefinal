import {
  googleSheetsService,
  normalizeHeader,
  normalizeText,
  normalizeComparison,
  dedupeHeaders,
  type GoogleSheetMatrix,
} from "../services/googleSheetsService";

// Fortuna Charts — soma o "impacto de carreira" de cada artista com base no
// histórico real de charts (Spotify, Apple Music, YouTube, Digital Sales,
// Billboard Hot 100 e Billboard 200), pra dar um número de fortuna
// realista baseado no que o artista efetivamente conquistou nos charts.
//
// Fonte dos dados: planilhas próprias de chart (chartsBase/chartsAlbums),
// nada a ver com ARTISTAS/EDIÇÃO CHARTS. Cada linha é um snapshot semanal
// — "VENDAS GERAIS" já é o acumulado até aquela semana, então usamos o
// MAIOR valor observado por música/álbum (equivale a pegar a semana mais
// recente, sem precisar ordenar por data).
//
// PESOS (constantes fáceis de ajustar — não tem "número certo", isso é uma
// aproximação realista que pode ser recalibrada a qualquer momento):
const PESOS = {
  // R$ por stream/play (Spotify, Apple Music, YouTube)
  valorPorStream: 0.015,
  // R$ por unidade vendida (Digital Sales, Billboard 200 de álbuns)
  valorPorVenda: 3,
  // Bônus único por melhor posição já alcançada naquele chart (prestígio
  // de ter chegado lá, independente de quantas semanas ficou).
  bonusPosicao(pos: number): number {
    if (pos === 1) return 300_000;
    if (pos <= 3) return 180_000;
    if (pos <= 5) return 120_000;
    if (pos <= 10) return 60_000;
    if (pos <= 20) return 25_000;
    if (pos <= 50) return 10_000;
    return 0;
  },
  // Bônus recorrente por cada semana passada na posição #1 daquele chart
  // (recompensa hit duradouro, não só ter chegado no topo uma vez).
  bonusPorSemanaNoTopo: 10_000,
};

const ARTISTAS_SHEET = "ARTISTAS";

function parseBR(v: string | undefined): number {
  const s = (v || "").trim();
  if (!s) return 0;
  const n = Number(s.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function formatBR(n: number): string {
  return Math.round(n).toLocaleString("pt-BR");
}

function colToLetter(n: number): string {
  let s = "";
  let x = n;
  while (x > 0) {
    const rem = (x - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}

interface Agregado {
  volumeMax: number;
  melhorPosicao: number;
  semanasNoTopo1: number;
  artistas: string[];
}

// Agrupa linhas de chart por identidade (música ou álbum), guardando o
// maior volume (VENDAS GERAIS acumulada), a melhor posição já alcançada e
// quantas semanas passou em #1.
function agregarPorChave(
  rows: string[][],
  posicaoIdx: number,
  volumeIdx: number | null,
  artistasIdx: number[],
): Map<string, Agregado> {
  const map = new Map<string, Agregado>();
  for (const r of rows) {
    const key = normalizeText(r[3]);
    if (!key) continue;
    const pos = Number(r[posicaoIdx]) || Infinity;
    const vol = volumeIdx !== null ? parseBR(r[volumeIdx]) : 0;
    let ag = map.get(key);
    if (!ag) {
      ag = { volumeMax: 0, melhorPosicao: Infinity, semanasNoTopo1: 0, artistas: [] };
      map.set(key, ag);
    }
    if (vol > ag.volumeMax) ag.volumeMax = vol;
    if (pos < ag.melhorPosicao) ag.melhorPosicao = pos;
    if (pos === 1) ag.semanasNoTopo1 += 1;
    if (ag.artistas.length === 0) {
      for (const idx of artistasIdx) {
        const a = normalizeText(r[idx]);
        if (a) ag.artistas.push(a);
      }
    }
  }
  return map;
}

function valorDoItem(ag: Agregado, unitValue: number): number {
  const volume = ag.volumeMax * unitValue;
  const posBonus = ag.melhorPosicao === Infinity ? 0 : PESOS.bonusPosicao(ag.melhorPosicao);
  const topoBonus = ag.semanasNoTopo1 * PESOS.bonusPorSemanaNoTopo;
  return volume + posBonus + topoBonus;
}

// Colunas 7-11 = ARTISTA 1-5 (feats/duetos creditam TODOS os artistas
// listados, cada um com o valor cheio — a própria planilha não faz split
// percentual entre eles, só lista quem participou).
const ARTISTAS_IDX_MUSICA = [7, 8, 9, 10, 11];

/**
 * POST /api/artistas/calcular-fortuna-charts
 * Lê o histórico completo dos 5 charts de música (Spotify, Apple Music,
 * YouTube, Digital Sales, Billboard Hot 100) + Billboard 200 de álbuns,
 * calcula a fortuna acumulada de cada artista com base em volume vendido/
 * tocado + prestígio de posição, e grava numa coluna nova "Fortuna Charts"
 * na aba ARTISTAS (cria a coluna se ainda não existir). Não mexe em
 * nenhuma outra coluna — quem não aparece em nenhum chart mantém o que já
 * tinha (célula intocada).
 */
export async function calcularFortunaChartsController(): Promise<Response> {
  try {
    const [spotify, apple, youtube, digital, hot100, albuns] = await Promise.all([
      googleSheetsService.chartsBase.readValues("SPOTIFY").catch(() => []),
      googleSheetsService.chartsBase.readValues("APPLE MUSIC").catch(() => []),
      googleSheetsService.chartsBase.readValues("YOUTUBE").catch(() => []),
      googleSheetsService.chartsBase.readValues("DIGITAL SALES").catch(() => []),
      googleSheetsService.chartsBase.readValues("BILLBOARD HOT 100").catch(() => []),
      googleSheetsService.chartsAlbums.readValues("DADOS ÁLBUNS").catch(() => []),
    ]);

    const porArtista = new Map<string, number>();
    const credita = (artistas: string[], valor: number) => {
      for (const nome of artistas) {
        const key = normalizeComparison(nome);
        if (!key) continue;
        porArtista.set(key, (porArtista.get(key) || 0) + valor);
      }
    };

    const streamCharts: string[][][] = [spotify, apple, youtube];
    for (const rows of streamCharts) {
      const ag = agregarPorChave(rows.slice(1), 2, 5, ARTISTAS_IDX_MUSICA);
      for (const item of ag.values()) credita(item.artistas, valorDoItem(item, PESOS.valorPorStream));
    }

    {
      const ag = agregarPorChave(digital.slice(1), 2, 5, ARTISTAS_IDX_MUSICA);
      for (const item of ag.values()) credita(item.artistas, valorDoItem(item, PESOS.valorPorVenda));
    }

    // Hot 100 não acumula "vendas gerais" — é só ranking/pontos semanais,
    // então conta apenas o bônus de posição (sem termo de volume).
    {
      const ag = agregarPorChave(hot100.slice(1), 2, null, ARTISTAS_IDX_MUSICA);
      for (const item of ag.values()) credita(item.artistas, valorDoItem(item, 0));
    }

    // Billboard 200 (álbuns): artista único na coluna 12, sem colunas de feat.
    {
      const ag = agregarPorChave(albuns.slice(1), 2, 5, [12]);
      for (const item of ag.values()) credita(item.artistas, valorDoItem(item, PESOS.valorPorVenda));
    }

    const rawRows = await googleSheetsService.usuarios.readValues(ARTISTAS_SHEET).catch(() => []);
    if (!rawRows || rawRows.length < 2) {
      return new Response(JSON.stringify({ success: false, error: "Aba ARTISTAS vazia ou inacessível." }), {
        status: 500,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }

    const headerRow = rawRows[0];
    const headers = dedupeHeaders(
      ARTISTAS_SHEET,
      headerRow.map((h, i) => normalizeHeader(h) || `coluna_${i + 1}`),
    );
    let colIdx = headers.indexOf("fortuna_charts");
    if (colIdx === -1) {
      colIdx = headerRow.length;
      await googleSheetsService.usuarios.updateValues(ARTISTAS_SHEET, `${colToLetter(colIdx + 1)}1`, [
        ["Fortuna Charts"],
      ]);
    }
    const colLetter = colToLetter(colIdx + 1);
    const nomeIdx = headers.indexOf("nome");

    const valuesOut: GoogleSheetMatrix = [];
    let atualizados = 0;
    for (let i = 1; i < rawRows.length; i++) {
      const nome = normalizeText(rawRows[i][nomeIdx]);
      const valor = nome ? porArtista.get(normalizeComparison(nome)) : undefined;
      if (valor !== undefined) {
        valuesOut.push([formatBR(valor)]);
        atualizados++;
      } else {
        // Sem dado novo pra esse artista — preserva o que já estava na célula.
        valuesOut.push([rawRows[i][colIdx] || ""]);
      }
    }

    await googleSheetsService.usuarios.updateValues(
      ARTISTAS_SHEET,
      `${colLetter}2:${colLetter}${rawRows.length}`,
      valuesOut,
    );

    return new Response(
      JSON.stringify({
        success: true,
        artistasAtualizados: atualizados,
        totalArtistasComChart: porArtista.size,
        coluna: colLetter,
      }),
      { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  } catch (error: any) {
    console.error("[calcularFortunaChartsController] Erro:", error);
    return new Response(
      JSON.stringify({ success: false, error: error?.message || "Erro ao calcular Fortuna Charts." }),
      { status: 500, headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  }
}

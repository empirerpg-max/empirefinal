import { googleSheetsService, normalizeText } from "../services/googleSheetsService";

// Diagnóstico read-only: dump ESPARSO (só células não-vazias, com índice
// 0-based exato) de um intervalo de linhas de "Musicas" — usado pra
// mapear com precisão onde o conteúdo real de cada linha caiu depois do
// bug de deslocamento de coluna do :append (ver appendRowMusicasSeguro
// em gestaoController.ts). Formato esparso em vez de slice/sample
// porque o deslocamento varia MUITO linha a linha (visto ao vivo: de 23
// a 50+ colunas de distância), e um range fixo de amostra corta dados
// importantes.
//
// GET /api/empire-play/admin/diagnostico-musicas-corruptas?inicio=770&fim=800
export async function adminDiagMusicasCorruptasController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const inicio = Number(url.searchParams.get("inicio") || "770");
  const fim = Number(url.searchParams.get("fim") || "800");

  // BZ (coluna 77) cortava dado real de linhas com deslocamento grande
  // (confirmado ao vivo: linha 778 continuava além de BZ) — ZZ (coluna
  // 701) dá folga de sobra pro pior caso já visto.
  const rows = await googleSheetsService.principal
    .readValues("Musicas", `A${inicio}:ZZ${fim}`)
    .catch(() => []);

  const achadas = rows.map((row, i) => {
    const linha = inicio + i;
    const celulas: { col: number; valor: string }[] = [];
    for (let c = 0; c < row.length; c++) {
      const v = normalizeText(row[c]);
      if (v) celulas.push({ col: c, valor: v.length > 80 ? `${v.slice(0, 80)}…(${v.length} chars)` : v });
    }
    return { linha, celulas };
  });

  return new Response(JSON.stringify({ success: true, inicio, fim, achadas }, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

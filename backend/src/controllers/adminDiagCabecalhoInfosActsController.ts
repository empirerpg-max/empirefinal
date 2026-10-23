import { googleSheetsService, normalizeText } from "../services/googleSheetsService";

// Confirma de verdade o mapeamento de colunas de INFOS ACTS — nunca mais
// supor. Devolve o cabeçalho (linha 1) coluna por coluna, e uma amostra de
// linhas com dado real (não vazias) pra comparar cabeçalho x conteúdo.
//
// GET /api/empire-play/admin/diagnostico-cabecalho-infos-acts?artista=Nome
export async function adminDiagCabecalhoInfosActsController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const artistaBusca = url.searchParams.get("artista");

  const rows = await googleSheetsService.registrosCharts.readValues("INFOS ACTS");
  const cabecalho = rows[0] || [];
  const colunas: Record<string, string> = {};
  for (let c = 0; c < Math.max(cabecalho.length, 20); c++) {
    colunas[String.fromCharCode(65 + c)] = normalizeText(cabecalho[c]);
  }

  let linhaArtista: Record<string, string> | null = null;
  if (artistaBusca) {
    const alvo = normalizeText(artistaBusca).toLowerCase();
    const row = rows.slice(1).find((r) => normalizeText(r[0]).toLowerCase() === alvo);
    if (row) {
      linhaArtista = {};
      for (let c = 0; c < Math.max(row.length, 20); c++) {
        linhaArtista[String.fromCharCode(65 + c)] = normalizeText(row[c]);
      }
    }
  }

  // Amostra: primeiras 5 linhas com qualquer dado em mais de 1 coluna
  // preenchida, pra ver conteúdo real lado a lado com o cabeçalho.
  const amostra: Record<string, string>[] = [];
  for (const row of rows.slice(1)) {
    const preenchidas = row.filter((v) => normalizeText(v)).length;
    if (preenchidas < 2) continue;
    const obj: Record<string, string> = {};
    for (let c = 0; c < Math.max(row.length, 20); c++) {
      obj[String.fromCharCode(65 + c)] = normalizeText(row[c]);
    }
    amostra.push(obj);
    if (amostra.length >= 5) break;
  }

  return new Response(
    JSON.stringify({ success: true, cabecalho: colunas, linhaArtista, amostra }, null, 2),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
}

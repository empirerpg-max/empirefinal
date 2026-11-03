import { googleSheetsService, normalizeComparison, normalizeText } from "../services/googleSheetsService";

// Só leitura. Usuário reportou: o lançamento de "Nobody's Wife" (Jessica
// Johnson) foi registrado como "ACT PRINCIPAL - ACT PRINCIPAL - Nobody's
// Wife" — o texto literal do CABEÇALHO da coluna ("ACT PRINCIPAL") entrou
// no valor, em vez do nome real da artista, e aparece duplicado. Lê as
// linhas reais de Musicas, Albuns e EDIÇÃO CHARTS relacionadas pra
// confirmar onde exatamente o valor errado foi gravado.
export async function adminDiagNobodysWifeController(): Promise<Response> {
  const musicasRows = await googleSheetsService.principal.readValues("Musicas", "A1:AE50000").catch(() => []);
  const musicasAchadas = musicasRows
    .map((row, i) => ({ linha: i + 1, row }))
    .filter(({ row }) => normalizeComparison((row || []).join(" | ")).includes("nobody") && normalizeComparison((row || []).join(" | ")).includes("wife"));

  const albunsRows = await googleSheetsService.principal.readValues("Albuns", "A1:Z20000").catch(() => []);
  const albunsAchados = albunsRows
    .map((row, i) => ({ linha: i + 1, row }))
    .filter(({ row }) => normalizeComparison((row || []).join(" | ")).includes("nobody") && normalizeComparison((row || []).join(" | ")).includes("wife"));

  const edicaoRows = await googleSheetsService.edicaoCharts.readValues("EDIÇÃO CHARTS", "A1:BD20000").catch(() => []);
  const edicaoAchados = edicaoRows
    .map((row, i) => ({ linha: i + 1, row }))
    .filter(({ row }) => normalizeComparison((row || []).join(" | ")).includes("nobody") && normalizeComparison((row || []).join(" | ")).includes("wife"));

  return new Response(
    JSON.stringify({ success: true, musicasAchadas, albunsAchados, edicaoAchados }, null, 2),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
}

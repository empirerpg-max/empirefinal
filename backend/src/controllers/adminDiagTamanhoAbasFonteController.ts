import { googleSheetsService } from "../services/googleSheetsService";

// Só leitura. Conta quantas linhas de fato têm dado na coluna A de cada
// aba-fonte usada pelas fórmulas de país (SPOTIFY, APPLE MUSIC, YOUTUBE,
// INFOS ACTS) — usado pra calcular um intervalo limitado (em vez de
// referência de coluna inteira, que estoura "limite de cálculo" do Sheets
// quando a fórmula virou válida de novo após o fix de locale).
//
// GET /api/empire-play/admin/diag-tamanho-abas-fonte
export async function adminDiagTamanhoAbasFonteController(): Promise<Response> {
  const abas = ["SPOTIFY", "APPLE MUSIC", "YOUTUBE", "INFOS ACTS"];
  const resultados: Record<string, number> = {};
  for (const aba of abas) {
    const rows = await googleSheetsService.chartsBase.readValues(aba, "A:A").catch(() => []);
    resultados[aba] = rows.length;
  }
  return new Response(JSON.stringify({ success: true, resultados }, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

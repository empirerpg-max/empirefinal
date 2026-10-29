import { googleSheetsService, normalizeComparison } from "../services/googleSheetsService";

// Só leitura. Dump bruto de Extra_Albuns pra investigar o bug do Shop
// compartilhado (DERBY mostrando produtos do Follia) — o diagnóstico por
// match exato de Código único não achou nenhuma linha pra EMPALBM090
// (Follia) nem EMPALBM093 (DERBY), o que é estranho dado que o usuário vê
// conteúdo real de Follia na tela do DERBY. Aqui lê a aba inteira e
// procura por "follia" ou "derby" em QUALQUER coluna (não só a primeira),
// pra achar onde esse conteúdo realmente mora.
export async function adminDumpExtraAlbunsController(): Promise<Response> {
  const rows = await googleSheetsService.usuarios.readValues("Extra_Albuns").catch(() => []);
  const relevantes = rows
    .map((row, i) => ({ linha: i + 1, row }))
    .filter(({ row }) => {
      const texto = normalizeComparison(row.join(" | "));
      return texto.includes("follia") || texto.includes("derby") || texto.includes("empalbm090") || texto.includes("empalbm093");
    });

  return new Response(
    JSON.stringify({ success: true, totalLinhas: rows.length, relevantes, primeiras5: rows.slice(0, 5) }, null, 2),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
}

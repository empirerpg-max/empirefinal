import { googleSheetsService, normalizeComparison } from "../services/googleSheetsService";

// Só leitura. Busca em LOGS (logsSistema) por qualquer entrada relacionada
// a "nosotros", "hirió"/"hirio", "vincular", "existente" ou "cowboy fresh"
// pra tentar achar o rastro exato de quando/como a linha 817 de "Musicas"
// (que tinha "Cowboy Fresh - Nosotros") virou "Cowboy Fresh - Se Me Hirió
// El Amor".
export async function adminDiagLogsNosotrosController(): Promise<Response> {
  const rows = await googleSheetsService.logsSistema.readValues("LOGS").catch(() => []);
  const termos = ["nosotros", "hirio", "hirió", "vincular", "cowboy fresh", "musicasseguro", "appendrow"];
  const relevantes = rows
    .map((row, i) => ({ linha: i + 1, row }))
    .filter(({ row }) => {
      const texto = normalizeComparison((row || []).join(" | "));
      return termos.some((t) => texto.includes(normalizeComparison(t)));
    });

  return new Response(
    JSON.stringify({ success: true, totalLinhas: rows.length, relevantes, ultimas15: rows.slice(-15) }, null, 2),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
}

import { googleSheetsService } from "../services/googleSheetsService";

// TEMPORÁRIO — inspeciona ao vivo as abas ECOIN e INVESTIMENTO pra mapear a
// estrutura real antes de migrar a tela "Aplicar playlists". Será removido
// depois do mapeamento.
export async function debugEcoinInvestimentoController(): Promise<Response> {
  const out: Record<string, unknown> = {};
  for (const nome of ["ECOIN", "INVESTIMENTO"]) {
    try {
      out[nome] = await googleSheetsService.registrosCharts.readValues(nome, "A1:BZ12");
    } catch (err: any) {
      out[nome] = { erro: err?.message || String(err) };
    }
  }
  return new Response(JSON.stringify(out), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

import { googleSheetsService } from "../services/googleSheetsService";

// Debug temporário: inspeciona a estrutura real da aba PONTOS pra mapear
// certinho a migração do sistema de Ponto. Remover depois de usar.
export async function debugPontoController(): Promise<Response> {
  const rows = await googleSheetsService.registrosCharts.readValues("PONTOS", "A1:BZ6");

  return new Response(JSON.stringify({ rows }, null, 2), {
    headers: { "Content-Type": "application/json" },
  });
}

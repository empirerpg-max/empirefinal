import { googleSheetsService } from "../services/googleSheetsService";

// TEMPORÁRIO — inspeciona ao vivo a aba REGISTRO (registrosCharts) e a aba
// EDIÇÃO CHARTS (edicaoCharts) pra confirmar o layout real antes de corrigir
// o audit log. Será removido depois.
export async function debugRegistroController(): Promise<Response> {
  const out: Record<string, unknown> = {};
  try {
    out.REGISTRO = await googleSheetsService.registrosCharts.readValues("REGISTRO", "A1:H10");
  } catch (err: any) {
    out.REGISTRO = { erro: err?.message || String(err) };
  }
  try {
    out["EDIÇÃO CHARTS"] = await googleSheetsService.edicaoCharts.readValues("EDIÇÃO CHARTS", "A1:H10");
  } catch (err: any) {
    out["EDIÇÃO CHARTS"] = { erro: err?.message || String(err) };
  }
  try {
    out["EDIÇÃO CHARTS ÁLBUMS"] = await googleSheetsService.edicaoCharts.readValues("EDIÇÃO CHARTS ÁLBUMS", "A1:H10");
  } catch (err: any) {
    out["EDIÇÃO CHARTS ÁLBUMS"] = { erro: err?.message || String(err) };
  }
  return new Response(JSON.stringify(out), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

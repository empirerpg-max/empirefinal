import { googleSheetsService, normalizeText } from "../services/googleSheetsService";

// Diagnóstico pontual (só leitura): confirmar ao vivo o conteúdo real das
// colunas A-J de "INFOS ACTS" (planilha registrosCharts) — especificamente
// a coluna G, que segundo a produção é uma fórmula que resolve qual foto
// exibir (C curada vs I upload do dono), pra parar de replicar essa lógica
// na mão no backend e passar a confiar direto no G.
const INFOS_ACTS_SHEET = "INFOS ACTS";

export async function adminDiagInfosActsController(): Promise<Response> {
  const rows = await googleSheetsService.registrosCharts.readValues(INFOS_ACTS_SHEET, "A1:J6").catch(() => []);
  const data = rows.map((r, i) => ({
    linha: i + 1,
    A: normalizeText(r[0]),
    B: normalizeText(r[1]),
    C: normalizeText(r[2]),
    D: normalizeText(r[3]),
    E: normalizeText(r[4]).slice(0, 40),
    F: normalizeText(r[5]),
    G: normalizeText(r[6]),
    H: normalizeText(r[7]),
    I: normalizeText(r[8]),
    J: normalizeText(r[9]),
  }));
  return new Response(JSON.stringify({ success: true, data }, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

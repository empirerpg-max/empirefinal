import { googleSheetsService, listSheetTabs } from "../services/googleSheetsService";

// TEMPORÁRIO — resolve os gids das abas ECOIN/INVESTIMENTO (das URLs que o
// usuário passou) pro nome real da aba na planilha registrosCharts, e lê a
// estrutura ao vivo (cabeçalhos + linhas de exemplo). Será removido depois
// do mapeamento.
const GIDS_ALVO: Record<string, number> = {
  ECOIN_OU_INVESTIMENTO: 1214241511,
};

export async function debugEcoinInvestimentoController(): Promise<Response> {
  const out: Record<string, unknown> = {};

  const tabs = await listSheetTabs("registrosCharts");
  out._abas = tabs;

  for (const [label, gid] of Object.entries(GIDS_ALVO)) {
    const tab = tabs.find((t) => t.sheetId === gid);
    if (!tab) {
      out[label] = { erro: `Nenhuma aba com gid ${gid} encontrada.` };
      continue;
    }
    try {
      out[tab.title] = await googleSheetsService.registrosCharts.readValues(tab.title, "A1:BZ12");
    } catch (err: any) {
      out[tab.title] = { erro: err?.message || String(err) };
    }
  }

  return new Response(JSON.stringify(out), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

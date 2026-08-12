import { googleSheetsService, listSheetTabs } from "../services/googleSheetsService";

// TEMPORÁRIO — resolve os gids das abas de badges/gamificação (planilha
// "usuarios") pro nome real e lê a estrutura ao vivo. Será removido depois
// do mapeamento.
const GIDS_ALVO = [838747018, 1763967987, 1242318680];

export async function debugGamificacaoController(): Promise<Response> {
  const out: Record<string, unknown> = {};
  const tabs = await listSheetTabs("usuarios");
  out._abas = tabs;

  for (const gid of GIDS_ALVO) {
    const tab = tabs.find((t) => t.sheetId === gid);
    if (!tab) {
      out[`gid_${gid}`] = { erro: "não encontrada" };
      continue;
    }
    try {
      out[tab.title] = await googleSheetsService.usuarios.readValues(tab.title, "A1:P20");
    } catch (err: any) {
      out[tab.title] = { erro: err?.message || String(err) };
    }
  }

  return new Response(JSON.stringify(out), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

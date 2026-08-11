import { googleSheetsService } from "../services/googleSheetsService";

// Debug temporário: mapeia as abas reais com "Playlist" no nome pra corrigir
// o mapeamento de colunas do playlistsController. Remover depois de usar.
export async function debugPlaylistsTabsController(): Promise<Response> {
  const all = await googleSheetsService.listSheetTitles("usuarios");
  const matches = all.filter((s) => /playlist/i.test(s.title));

  const details = await Promise.all(
    matches.map(async (s) => {
      const rows = await googleSheetsService.usuarios.readValues(s.title, "A1:Z5");
      return { title: s.title, sheetId: s.id, sample: rows };
    }),
  );

  return new Response(JSON.stringify({ allTitles: all.map((s) => s.title), matches: details }, null, 2), {
    headers: { "Content-Type": "application/json" },
  });
}

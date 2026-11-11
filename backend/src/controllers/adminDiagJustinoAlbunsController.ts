import { googleSheetsService, normalizeComparison } from "../services/googleSheetsService";

// Diagnóstico pontual (2026-11-11): jogador Justino reportou que "Editar
// Lançamentos" só mostra o álbum "Chronicles", mesmo ele tendo outros
// álbuns. Dump de: linha(s) dele em "Jogadores" (Usuários), linha(s) em
// "ARTISTAS" (Usuários), e TODAS as linhas de "Albuns" (planilha principal)
// onde o criador (coluna F) ou o texto da linha batem com "justino" — pra
// comparar com o que /api/editar?artist=X&tipo=albuns realmente devolve.
//
// GET /api/gestao/admin/diag-justino-albuns
export async function adminDiagJustinoAlbunsController(): Promise<Response> {
  const jogadoresRows = await googleSheetsService.principal.readValues("Jogadores", "A:M").catch(() => []);
  const linhasJogadores = jogadoresRows
    .map((row, i) => ({ linha: i + 1, row }))
    .filter(({ row }) => normalizeComparison(row.join(" ")).includes("justino"))
    .map(({ linha, row }) => ({
      linha,
      artistName: row[0],
      telegramId: row[1],
      playerName: row[2],
      listaArtistas: row[12],
    }));

  const artistasRows = await googleSheetsService.usuarios.readValues("ARTISTAS").catch(() => []);
  const linhasArtistas = artistasRows
    .map((row, i) => ({ linha: i + 1, row }))
    .filter(({ row }) => normalizeComparison(row.join(" ")).includes("justino"));

  const albunsRows = await googleSheetsService.principal.readValues("Albuns").catch(() => []);
  const linhasAlbuns = albunsRows
    .map((row, i) => ({ linha: i + 1, row }))
    .filter(
      ({ row }) =>
        normalizeComparison(row.join(" ")).includes("justino") ||
        normalizeComparison(row.join(" ")).includes("samantha cooper"),
    )
    .map(({ linha, row }) => ({
      linha,
      data: row[0],
      topicId: row[1],
      criador: row[5],
      titulo: row[6],
    }));

  return new Response(
    JSON.stringify({ success: true, linhasJogadores, linhasArtistas, linhasAlbuns }, null, 2),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
}

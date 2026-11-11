import { googleSheetsService, normalizeComparison } from "../services/googleSheetsService";

// Diagnóstico pontual (2026-11-11): álbum "Samantha Cooper - WELL, IT'S
// OVER" (pre-save PRESAVE-f4ed19ad) foi lançado hoje com só 3 faixas, mas a
// campanha tinha 11 faixas cadastradas (confirmado via /api/presave/
// diagnostico). Dump de LOGS (falhas de escrita registradas no lançamento)
// + linhas de Musicas que batem com o álbum, pra achar quantas faixas de
// verdade foram gravadas e por que as outras faltaram.
//
// GET /api/gestao/admin/diag-faixas-samantha
export async function adminDiagFaixasSamanthaController(): Promise<Response> {
  const logsRows = await googleSheetsService.logsSistema.readValues("LOGS").catch(() => []);
  const logsRelevantes = logsRows
    .map((row, i) => ({ linha: i + 1, row }))
    .filter(({ row }) =>
      normalizeComparison(row.join(" ")).includes(normalizeComparison("well")) ||
      normalizeComparison(row.join(" ")).includes(normalizeComparison("samantha")),
    );

  const musicasRows = await googleSheetsService.principal.readValues("Musicas", "A:Z").catch(() => []);
  const musicasDoAlbum = musicasRows
    .map((row, i) => ({ linha: i + 1, row }))
    .filter(({ row }) => normalizeComparison(row[10] || "").includes(normalizeComparison("well")));

  return new Response(
    JSON.stringify(
      {
        success: true,
        logsRelevantes,
        totalMusicasDoAlbum: musicasDoAlbum.length,
        musicasDoAlbum: musicasDoAlbum.map(({ linha, row }) => ({
          linha,
          data: row[0],
          titulo: row[7],
          tipoSingle: row[8],
          album: row[10],
          ordem: row[20],
          pendente: row[23],
        })),
      },
      null,
      2,
    ),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
}

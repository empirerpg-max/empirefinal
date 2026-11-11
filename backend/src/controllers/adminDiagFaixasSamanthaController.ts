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
  const totalLogs = logsRows.length;
  const ultimosLogs = logsRows.slice(-40).map((row, i) => ({ linha: totalLogs - 40 + i + 1, row }));

  const musicasRows = await googleSheetsService.principal.readValues("Musicas", "A:Z").catch(() => []);
  const musicasDoAlbum = musicasRows
    .map((row, i) => ({ linha: i + 1, row }))
    .filter(({ row }) => normalizeComparison(row[10] || "").includes(normalizeComparison("well")));

  // "IT'S OVER" reportado pelo usuário como JÁ publicada antes (código
  // único EMP999) — busca GLOBAL (não só nesse álbum) por qualquer linha de
  // Musicas cujo título bata com "it's over" ou cujo Código único (Z,
  // índice 25) seja exatamente "EMP999", pra achar a linha original e
  // comparar com a que o relançamento pode ter duplicado.
  const linhasItsOver = musicasRows
    .map((row, i) => ({ linha: i + 1, row }))
    .filter(
      ({ row }) =>
        normalizeComparison(row[7] || "").includes(normalizeComparison("it's over")) ||
        normalizeComparison(row[25] || "") === normalizeComparison("emp999"),
    );

  return new Response(
    JSON.stringify(
      {
        success: true,
        totalLogs,
        ultimosLogs,
        logsRelevantes,
        totalMusicasDoAlbum: musicasDoAlbum.length,
        musicasDoAlbum: musicasDoAlbum.map(({ linha, row }) => ({
          linha,
          data: row[0],
          topicId: row[1],
          titulo: row[7],
          tipoSingle: row[8],
          album: row[10],
          ordem: row[20],
          pendente: row[23],
          codigoUnico: row[25],
        })),
        linhasItsOver: linhasItsOver.map(({ linha, row }) => ({
          linha,
          data: row[0],
          topicId: row[1],
          titulo: row[7],
          tipoSingle: row[8],
          album: row[10],
          ordem: row[20],
          pendente: row[23],
          codigoUnico: row[25],
        })),
      },
      null,
      2,
    ),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
}

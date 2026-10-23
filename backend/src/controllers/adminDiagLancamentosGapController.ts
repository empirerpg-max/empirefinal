import { googleSheetsService, normalizeText } from "../services/googleSheetsService";
import { parseDateToIso } from "./empirePlayController";

// Usuário perguntou: "tiveram outros lançamentos depois de follia que
// deveriam estar ali, não?" (sobre o single "Follia", 30/09, aparecendo
// como 3º card em Lançamentos Recentes). Dump de QUALQUER lançamento
// (música ou álbum, qualquer artista) com data entre 30/09/2026 (exclusive)
// e 21/10/2026 (exclusive) em EDIÇÃO CHARTS/EDIÇÃO CHARTS ÁLBUMS, pra ver
// se existe algo mais recente que deveria ter aparecido no lugar dele.
// Também traz a linha de Musicas do single "Follia" (linha 760) completa,
// pra ver se tem alguma capa própria perdida em outra coluna.
//
// GET /api/empire-play/admin/diagnostico-lancamentos-gap
export async function adminDiagLancamentosGapController(): Promise<Response> {
  const [musicasRows, albunsRows, musicasFolliaRow] = await Promise.all([
    googleSheetsService.edicaoCharts.readValues("EDIÇÃO CHARTS", "A2:BD5000").catch(() => []),
    googleSheetsService.edicaoCharts.readValues("EDIÇÃO CHARTS ÁLBUMS", "A2:R5000").catch(() => []),
    googleSheetsService.principal.readValues("Musicas", "A760:AE760").catch(() => []),
  ]);

  const INICIO = "2026-09-30";
  const FIM = "2026-10-21";

  const noIntervalo = (iso: string | null) => !!iso && iso > INICIO && iso < FIM;

  const musicasNoGap = musicasRows
    .map((row, i) => ({
      linha: i + 2,
      dataIso: parseDateToIso(row[0] || null),
      titulo: normalizeText(row[1]),
      codigoUnico: normalizeText(row[55]),
    }))
    .filter((r) => noIntervalo(r.dataIso));

  const albunsNoGap = albunsRows
    .map((row, i) => ({
      linha: i + 2,
      dataIso: parseDateToIso(row[1] || null),
      artista: normalizeText(row[0]),
      album: normalizeText(row[3]),
      codigoUnico: normalizeText(row[17]),
    }))
    .filter((r) => noIntervalo(r.dataIso));

  return new Response(
    JSON.stringify(
      {
        success: true,
        intervalo: `${INICIO} (exclusive) a ${FIM} (exclusive)`,
        musicasNoGap,
        albunsNoGap,
        linhaMusicasFollia760: (musicasFolliaRow[0] || []).map((c) => normalizeText(c)),
      },
      null,
      2,
    ),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
}

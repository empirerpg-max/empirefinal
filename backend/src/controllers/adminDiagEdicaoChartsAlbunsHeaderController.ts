import { googleSheetsService, normalizeText } from "../services/googleSheetsService";

// Diagnóstico read-only: usuário reportou que a coluna "PRE-SAVE" de
// "EDIÇÃO CHARTS ÁLBUMS" não recebeu o valor combinado pro álbum FOLLIA
// (Max Gorghan). Dump do cabeçalho completo da aba (pra achar em que
// coluna/letra fica "PRE-SAVE" de verdade) + a linha gravada do FOLLIA
// (pelo Código único EMPALBM090, já confirmado nessa sessão) pra ver o
// que está (ou não) nela.
//
// GET /api/empire-play/admin/diagnostico-edicao-charts-albuns-header
export async function adminDiagEdicaoChartsAlbunsHeaderController(): Promise<Response> {
  const rows = await googleSheetsService.edicaoCharts
    .readValues("EDIÇÃO CHARTS ÁLBUMS", "A1:BZ20000")
    .catch(() => []);
  const header = (rows[0] || []).map((c) => normalizeText(c));

  let linhaFollia: Record<string, unknown> | null = null;
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    if (normalizeText(row[17]) !== "EMPALBM090") continue; // R = Código único
    const porColuna: Record<string, string> = {};
    header.forEach((h, idx) => {
      if (h) porColuna[h] = normalizeText(row[idx]);
    });
    linhaFollia = { linha: i + 1, porColuna, rowBruta: row.map((c) => normalizeText(c)) };
    break;
  }

  return new Response(
    JSON.stringify({ success: true, header, linhaFollia }, null, 2),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
}

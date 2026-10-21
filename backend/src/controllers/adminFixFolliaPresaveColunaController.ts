import { googleSheetsService, normalizeComparison } from "../services/googleSheetsService";

// Conserto único (não é rota de uso recorrente): a coluna "PRE-SAVE" (S)
// de "EDIÇÃO CHARTS ÁLBUMS" nunca foi escrita por nenhum código até agora
// (feature combinada mas nunca implementada — ver fix em
// registrarAlbumNaEdicaoChartsAlbuns/publicarAlbum, que agora recebe
// `veioDoPreSave` e grava "SIM" na coluna S quando o lançamento vem do
// cron de pre-save). Esse endpoint só corrige retroativamente a linha já
// existente do álbum FOLLIA (Max Gorghan, Código único EMPALBM090,
// lançado antes dessa correção existir).
// Identifica pelo Código único (coluna R, estável), nunca só pelo nome.
// GET /api/empire-play/admin/fix-follia-presave-coluna
export async function adminFixFolliaPresaveColunaController(): Promise<Response> {
  const CODIGO_UNICO_ALVO = "EMPALBM090";

  const rows = await googleSheetsService.edicaoCharts
    .readValues("EDIÇÃO CHARTS ÁLBUMS", "A1:S20000")
    .catch(() => []);
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    const codigo = (row[17] || "").trim(); // R - Código único
    if (normalizeComparison(codigo) !== normalizeComparison(CODIGO_UNICO_ALVO)) continue;

    const valorAtual = (row[18] || "").trim(); // S - PRE-SAVE
    if (normalizeComparison(valorAtual) === normalizeComparison("SIM")) {
      return new Response(JSON.stringify({ success: true, ok: false, motivo: "Já estava preenchido." }), {
        status: 200,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }

    await googleSheetsService.edicaoCharts.updateValues("EDIÇÃO CHARTS ÁLBUMS", `S${i + 1}`, [["SIM"]]);
    return new Response(
      JSON.stringify({ success: true, ok: true, linha: i + 1, valorAntigo: valorAtual, valorNovo: "SIM" }),
      { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  }

  return new Response(
    JSON.stringify({ success: true, ok: false, motivo: "Linha não encontrada (Código único não bateu)." }),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
}

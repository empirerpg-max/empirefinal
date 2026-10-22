import { googleSheetsService, normalizeComparison } from "../services/googleSheetsService";
import { mirrorMusicaRowParaD1 } from "./gestaoController";

// Conserto único (não é rota de uso recorrente): a linha 779 de "Musicas"
// (faixa "Alchimia", álbum Max Gorghan - FOLLIA, Código único EMP948)
// teve a coluna H corrompida pra "Alchimi - Alchimia" por
// updateReleaseController (bug já corrigido — ver editController.ts),
// que confiava cegamente no `artista` vindo do front-end em vez de
// derivar da coluna N (Artista Principal, que continuou certa:
// "Max Gorghan"). Corrige H de volta, propaga pra EDIÇÃO CHARTS!B (que
// recebeu a mesma cópia errada) e re-espelha a linha pro D1.
// Identifica pela linha exata (estável, já confirmada via diagnóstico),
// nunca só pelo título.
//
// GET /api/empire-play/admin/fix-alchimia-titulo
export async function adminFixAlchimiaTituloController(): Promise<Response> {
  const LINHA_MUSICAS = 779;
  const TITULO_CORRIGIDO = "Max Gorghan - Alchimia";
  const TITULO_ERRADO = "Alchimi - Alchimia";
  const CODIGO_UNICO = "EMP948";

  const rowAtual = (
    await googleSheetsService.principal.readValues("Musicas", `H${LINHA_MUSICAS}:H${LINHA_MUSICAS}`).catch(() => [])
  )[0];
  const tituloAtual = (rowAtual?.[0] || "").trim();
  if (normalizeComparison(tituloAtual) !== normalizeComparison(TITULO_ERRADO)) {
    return new Response(
      JSON.stringify({
        success: true,
        ok: false,
        motivo: `Título atual na linha ${LINHA_MUSICAS} não é mais "${TITULO_ERRADO}" (é "${tituloAtual}") — não mexido, pra não arriscar sobrescrever outra correção.`,
      }),
      { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  }

  await googleSheetsService.principal.updateValues("Musicas", `H${LINHA_MUSICAS}`, [[TITULO_CORRIGIDO]]);

  let edicaoChartsCorrigida = false;
  try {
    const edicaoRows = await googleSheetsService.edicaoCharts.readValues("EDIÇÃO CHARTS");
    for (let i = 1; i < edicaoRows.length; i++) {
      const codigo = (edicaoRows[i]?.[55] || "").trim(); // BD - Código único
      if (normalizeComparison(codigo) !== normalizeComparison(CODIGO_UNICO)) continue;
      await googleSheetsService.edicaoCharts.updateValues("EDIÇÃO CHARTS", `B${i + 1}`, [[TITULO_CORRIGIDO]]);
      edicaoChartsCorrigida = true;
      break;
    }
  } catch (err) {
    console.warn("[adminFixAlchimiaTituloController] Erro ao corrigir EDIÇÃO CHARTS:", err);
  }

  await mirrorMusicaRowParaD1(LINHA_MUSICAS).catch((err) =>
    console.warn("[adminFixAlchimiaTituloController] Erro ao re-espelhar pro D1:", err),
  );

  return new Response(
    JSON.stringify({ success: true, ok: true, linha: LINHA_MUSICAS, tituloAntigo: TITULO_ERRADO, tituloNovo: TITULO_CORRIGIDO, edicaoChartsCorrigida }),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
}

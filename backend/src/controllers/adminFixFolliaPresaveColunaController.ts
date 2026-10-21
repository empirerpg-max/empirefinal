import { googleSheetsService, normalizeComparison } from "../services/googleSheetsService";
import { readAllCampanhas, calcularAcumulado } from "./preSaveController";

// Conserto único (não é rota de uso recorrente): a coluna "PRE-SAVE" (S)
// de "EDIÇÃO CHARTS ÁLBUMS" ficou vazia pro álbum FOLLIA — o código real
// (processarLancamentosPreSaveScheduled) só grava essa coluna quando a
// campanha é modo "missao"; se for "contagem" ela fica vazia de propósito
// (vanity puro). Esse endpoint lê a campanha real (PRESAVE-7da5f189),
// calcula o valor com a MESMA fórmula usada no lançamento normal
// (calcularAcumulado) e só grava se o modo for "missao" — nunca escreve
// um valor arbitrário.
//
// IMPORTANTE: a tentativa anterior desse fix gravou "SIM" (errado,
// inventado sem confirmar o valor real combinado) — esse endpoint
// substitui esse valor pelo número real sempre que aplicável.
//
// GET /api/empire-play/admin/fix-follia-presave-coluna
export async function adminFixFolliaPresaveColunaController(): Promise<Response> {
  const CODIGO_UNICO_ALVO = "EMPALBM090";

  const campanhas = await readAllCampanhas().catch(() => []);
  const c = campanhas.find((x) => x.id === "PRESAVE-7da5f189");
  if (!c) {
    return new Response(JSON.stringify({ success: false, error: "Campanha PRESAVE-7da5f189 não encontrada." }), {
      status: 404,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  if (c.modo !== "missao") {
    return new Response(
      JSON.stringify({
        success: true,
        ok: false,
        motivo: `Campanha é modo "${c.modo}" — coluna PRE-SAVE fica vazia de propósito nesse modo (só modo "missao" grava valor).`,
      }),
      { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  }

  const valorReal = String(Math.round(calcularAcumulado(c)));

  const rows = await googleSheetsService.edicaoCharts.readValues("EDIÇÃO CHARTS ÁLBUMS", "A1:S20000").catch(() => []);
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    const codigo = (row[17] || "").trim(); // R - Código único
    if (normalizeComparison(codigo) !== normalizeComparison(CODIGO_UNICO_ALVO)) continue;

    const valorAtual = (row[18] || "").trim(); // S - PRE-SAVE
    await googleSheetsService.edicaoCharts.updateValues("EDIÇÃO CHARTS ÁLBUMS", `S${i + 1}`, [[valorReal]]);
    return new Response(
      JSON.stringify({ success: true, ok: true, linha: i + 1, valorAntigo: valorAtual, valorNovo: valorReal }),
      { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  }

  return new Response(
    JSON.stringify({ success: true, ok: false, motivo: "Linha não encontrada (Código único não bateu)." }),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
}

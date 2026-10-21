import { googleSheetsService, normalizeText, normalizeComparison } from "../services/googleSheetsService";

// FIX DE EMERGÊNCIA (não é a correção definitiva — só estanca a sangria):
// a campanha PRESAVE-7da5f189 (Max Gorghan - FOLLIA) está presa em
// status="ativa" há horas e o cron (a cada ~10min) já publicou o álbum
// 53 vezes (confirmado via adminDiagFolliaController) porque algo em
// publicarAlbum lança exceção DEPOIS de já criar a linha em "Albuns" mas
// ANTES de voltar o codigoUnico pra lancarCampanhaPreSave gravar
// status="lancada" — então toda rodada seguinte do cron ainda vê "ativa"
// e publica de novo. Esse endpoint escreve status="lancada" direto na
// célula M da campanha, SEM rodar publicarAlbum de novo, só pra parar o
// cron de continuar duplicando enquanto a causa raiz é investigada.
// ?dryRun=1 só mostra o que seria escrito, sem gravar.
//
// GET /api/empire-play/admin/parar-presave-follia?dryRun=1
export async function adminStopFolliaPresaveController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const dryRun = url.searchParams.get("dryRun") === "1";

  const rows = await googleSheetsService.principal.readValues("PreSave_Album", "A1:U2000").catch(() => []);
  let linhaAlvo = -1;
  let statusAtual = "";
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    if (normalizeText(row[0]) === "PRESAVE-7da5f189") {
      linhaAlvo = i + 1;
      statusAtual = normalizeText(row[12]);
      break;
    }
  }

  if (linhaAlvo < 0) {
    return new Response(
      JSON.stringify({ success: false, error: "Campanha PRESAVE-7da5f189 não encontrada." }, null, 2),
      { status: 404, headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  }

  if (normalizeComparison(statusAtual) !== "ativa") {
    return new Response(
      JSON.stringify(
        { success: true, jaResolvido: true, linha: linhaAlvo, statusAtual },
        null,
        2,
      ),
      { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  }

  if (!dryRun) {
    await googleSheetsService.principal.updateValues(
      "PreSave_Album",
      `M${linhaAlvo}:M${linhaAlvo}`,
      [["lancada"]],
    );
  }

  return new Response(
    JSON.stringify(
      { success: true, dryRun, linha: linhaAlvo, statusAnterior: statusAtual, statusNovo: "lancada" },
      null,
      2,
    ),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
}

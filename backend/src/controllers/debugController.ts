import { googleSheetsService, listSheetTabs, normalizeComparison } from "../services/googleSheetsService";

// TEMPORÁRIO — descobre o erro real (não escondido) ao tentar gravar em
// REGISTRO, e confirma o nome exato da aba na planilha registrosCharts.
export async function debugRegistroWriteController(): Promise<Response> {
  const abas = await listSheetTabs("registrosCharts").catch((e) => [{ title: `erro: ${e}`, sheetId: -1 }]);
  const abaRegistro = abas.find((a) => normalizeComparison(a.title) === normalizeComparison("REGISTRO"));

  let erroGravacao: string | null = null;
  let linhaGravada: number | null = null;
  let contaDeServico: string | null = null;
  try {
    const spreadsheetId = "1wNbtP78MrtrOc2Jb1ejXcHVjqndR2Vm4-3EIVqa8aOg";
    const a1Range = encodeURIComponent(`'${abaRegistro?.title || "REGISTRO"}'!B:D`);
    const { getGoogleAccessToken, getServiceAccountEmail } = await import("../google/service-account");
    const token = await getGoogleAccessToken(["https://www.googleapis.com/auth/spreadsheets"]);
    contaDeServico = getServiceAccountEmail();
    const res = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${a1Range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          majorDimension: "ROWS",
          values: [["TESTE_DEBUG_CLAUDE", "Marco - Home", "COMENTÁRIO"]],
        }),
      },
    );
    const body = await res.text();
    if (!res.ok) {
      erroGravacao = `HTTP ${res.status}: ${body}`;
    } else {
      const parsed = JSON.parse(body);
      const match = (parsed.updates?.updatedRange || "").match(/![A-Z]+(\d+)/);
      linhaGravada = match ? parseInt(match[1], 10) : null;
    }
  } catch (err: any) {
    erroGravacao = err?.message || String(err);
  }

  const registro = await googleSheetsService.registrosCharts.readValues("REGISTRO").catch((e) => [["erro", String(e)]]);

  return new Response(
    JSON.stringify(
      {
        conta_de_servico: contaDeServico,
        abas_da_planilha_registrosCharts: abas.map((a) => a.title),
        aba_registro_encontrada: abaRegistro?.title || null,
        teste_gravacao_direta: { erro: erroGravacao, linha: linhaGravada },
        registro_ultimas_5_apos_teste: registro.slice(-5),
      },
      null,
      2,
    ),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

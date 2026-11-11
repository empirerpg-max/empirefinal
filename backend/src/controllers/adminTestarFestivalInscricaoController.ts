import { readValues, updateValues, normalizeText, normalizeComparison } from "../services/googleSheetsService";
import { postFestivalInscricaoController } from "./festivaisController";

// Teste pontual (2026-11-11), self-cleaning: chama o POST real de
// /api/festivais/inscricao com dados de teste (Justino/Kendall/Pop),
// confirma que a linha foi escrita corretamente, depois apaga essa linha de
// teste (nunca deixa dado fake na planilha de produção).
//
// GET /api/gestao/admin/testar-festival-inscricao
export async function adminTestarFestivalInscricaoController(): Promise<Response> {
  const FESTIVAIS_SPREADSHEET_ID = "1lFw9l76tYZYCDXhZsoiftIEzCvKcjCrI_oBpvUdwAlo";
  const FESTIVAIS_SHEET = "Inscrições_Festivais";
  const telegramIdTeste = "1594615219"; // Justino
  const artistaTeste = "Kendall";
  const generoTeste = "Pop";

  const fakeRequest = new Request("https://internal.empire/api/festivais/inscricao", {
    method: "POST",
    body: JSON.stringify({ telegramId: telegramIdTeste, artista: artistaTeste, genero: generoTeste }),
  });
  const resposta = await postFestivalInscricaoController(fakeRequest);
  const respostaJson = await resposta.json();

  const rows = await readValues(FESTIVAIS_SPREADSHEET_ID, FESTIVAIS_SHEET, "A2:C20000").catch(() => []);
  const idx = rows.findIndex((r) => normalizeComparison(normalizeText(r[0])) === normalizeComparison(artistaTeste));
  const linhaEncontrada = idx !== -1 ? { linha: idx + 2, row: rows[idx] } : null;

  // Limpeza — apaga a linha de teste independente do resultado, pra nunca
  // deixar "Kendall"/teste na planilha de produção.
  if (linhaEncontrada) {
    await updateValues(FESTIVAIS_SPREADSHEET_ID, FESTIVAIS_SHEET, `A${linhaEncontrada.linha}:C${linhaEncontrada.linha}`, [
      ["", "", ""],
    ]);
  }

  return new Response(
    JSON.stringify({ success: true, respostaDoPost: respostaJson, linhaEncontradaAntesDeLimpar: linhaEncontrada, limpou: !!linhaEncontrada }, null, 2),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
}

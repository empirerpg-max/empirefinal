import { googleSheetsService, normalizeText } from "../services/googleSheetsService";

// Conserto pontual: Justino (dono de Samantha Cooper) acabou reservando 2
// linhas na aba "ECOIN + INVESTIMENTO" pra mesma música (Samantha Cooper -
// CURSED BLESSED). A primeira (linha 27) já foi usada com sucesso — tem
// playlist escolhida nas 3 plataformas. A segunda (linha 28) ficou órfã:
// artista preenchido (Samantha Cooper) mas música vazia — sobrou assim de
// quando ele tentou de novo antes da correção de idempotência entrar no
// ar. iniciarInvestimentoController agora reaproveita a linha existente em
// vez de criar outra, então isso não deve se repetir; esse endpoint só
// limpa essa linha órfã, liberando ela de volta pro pool da semana.
const SHEET = "ECOIN + INVESTIMENTO";
const LINHA_ORFA = 28; // confirmado ao vivo: sobra da 2ª tentativa pra "Samantha Cooper - CURSED BLESSED"
const ARTISTA_ESPERADO = "Samantha Cooper";

export async function adminFixDuplicataInvestimentoController(): Promise<Response> {
  const cells = await googleSheetsService.registrosCharts.readValues(SHEET, `A${LINHA_ORFA}:O${LINHA_ORFA}`);
  const row = cells?.[0] || [];

  const artista = normalizeText(row[2]); // C
  const musica = normalizeText(row[4]); // E
  const spotify = normalizeText(row[6]); // G
  const apple = normalizeText(row[8]); // I
  const youtube = normalizeText(row[10]); // K

  if (artista !== ARTISTA_ESPERADO || musica || spotify || apple || youtube) {
    return new Response(
      JSON.stringify({
        success: false,
        error: "O estado atual da linha não é o esperado (artista preenchido, resto vazio) — abortado por segurança, nada foi alterado.",
        linha: LINHA_ORFA,
        artista,
        musica,
        spotify,
        apple,
        youtube,
      }),
      { status: 409, headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  }

  // Só C — D é fórmula (PROCV do saldo do artista), nunca escrita; E já
  // está vazia.
  await googleSheetsService.registrosCharts.updateValues(SHEET, `C${LINHA_ORFA}`, [[""]]);

  return new Response(
    JSON.stringify({ success: true, linha: LINHA_ORFA, artista }),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
}

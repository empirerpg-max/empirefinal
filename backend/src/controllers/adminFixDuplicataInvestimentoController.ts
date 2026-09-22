import { googleSheetsService, normalizeText } from "../services/googleSheetsService";

// Conserto pontual: Justino (dono de Samantha Cooper) acabou reservando 2
// linhas na aba "ECOIN + INVESTIMENTO" pra mesma música (Samantha Cooper -
// CURSED BLESSED), ambas sem nenhuma playlist escolhida — clássico
// resultado de clicar "Nova" mais de uma vez achando que não tinha
// funcionado. iniciarInvestimentoController agora é idempotente pra isso
// não acontecer de novo (reaproveita a linha existente em vez de criar
// outra); esse endpoint só limpa a linha duplicada que já ficou perdida,
// liberando ela de volta pro pool comum de linhas livres da semana.
const SHEET = "ECOIN + INVESTIMENTO";
const LINHA_DUPLICADA = 28; // confirmado ao vivo: 2ª reserva de "Samantha Cooper - CURSED BLESSED"
const ARTISTA_ESPERADO = "Samantha Cooper";
const MUSICA_ESPERADA = "Samantha Cooper - CURSED BLESSED";

export async function adminFixDuplicataInvestimentoController(): Promise<Response> {
  const cells = await googleSheetsService.registrosCharts.readValues(SHEET, `A${LINHA_DUPLICADA}:O${LINHA_DUPLICADA}`);
  const row = cells?.[0] || [];

  const artista = normalizeText(row[2]); // C
  const musica = normalizeText(row[4]); // E
  const spotify = normalizeText(row[6]); // G
  const apple = normalizeText(row[8]); // I
  const youtube = normalizeText(row[10]); // K

  if (artista !== ARTISTA_ESPERADO || musica !== MUSICA_ESPERADA || spotify || apple || youtube) {
    return new Response(
      JSON.stringify({
        success: false,
        error: "O estado atual da linha não é o duplicado esperado — abortado por segurança, nada foi alterado.",
        linha: LINHA_DUPLICADA,
        artista,
        musica,
        spotify,
        apple,
        youtube,
      }),
      { status: 409, headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  }

  // Só C e E — D é fórmula (PROCV do saldo do artista), nunca escrita.
  await googleSheetsService.registrosCharts.updateValues(SHEET, `C${LINHA_DUPLICADA}`, [[""]]);
  await googleSheetsService.registrosCharts.updateValues(SHEET, `E${LINHA_DUPLICADA}`, [[""]]);

  return new Response(
    JSON.stringify({ success: true, linha: LINHA_DUPLICADA, artista, musica }),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
}

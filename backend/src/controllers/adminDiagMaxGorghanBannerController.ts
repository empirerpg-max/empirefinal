import { googleSheetsService, normalizeText, normalizeComparison } from "../services/googleSheetsService";

// Diagnóstico pontual (só leitura): o banner do Max Gorghan foi comprado
// sob a lógica antiga do Spotlight Banner (antes do desconto imediato em
// DADOS!AD e da reserva de linha em ECOIN + INVESTIMENTO na compra).
// Precisamos ver se já existe alguma linha em ECOIN + INVESTIMENTO com
// C="Max Gorghan" (sinal de que o bônus de playlist já rodou via
// registrarInvestimentoAutomatico, antigo) antes de decidir se o
// retroativo é só cosmético ou se precisa descontar saldo de verdade.
const ARTISTA_ALVO = "Max Gorghan";

export async function adminDiagMaxGorghanBannerController(): Promise<Response> {
  const [bannerRows, ecoinRows, dadosRows] = await Promise.all([
    googleSheetsService.usuarios.readValues("MARKET_BANNERS").catch(() => []),
    googleSheetsService.registrosCharts.readValues("ECOIN + INVESTIMENTO").catch(() => []),
    googleSheetsService.registrosCharts.readValues("DADOS", "AC1:AI5000").catch(() => []),
  ]);

  const normAlvo = normalizeComparison(ARTISTA_ALVO);

  const banners = bannerRows
    .slice(1)
    .map((r, i) => ({
      linha: i + 2,
      id: normalizeText(r[0]),
      data: normalizeText(r[1]),
      telegramId: normalizeText(r[2]),
      usuario: normalizeText(r[3]),
      artista: normalizeText(r[4]),
      plataforma: normalizeText(r[5]),
      musicaOuAlbum: normalizeText(r[6]),
      topicoId: normalizeText(r[7]),
      dataExpira: normalizeText(r[9]),
      status: normalizeText(r[10]),
      linhaEcoin: normalizeText(r[12]) || null,
    }))
    .filter((b) => normalizeComparison(b.artista) === normAlvo);

  const ecoinLinhasDoArtista = ecoinRows
    .map((r, i) => ({
      linha: i + 1,
      artista: normalizeText(r[2]), // C
      musica: normalizeText(r[4]), // E
      spotify: normalizeText(r[6]), // G
      apple: normalizeText(r[8]), // I
      youtube: normalizeText(r[10]), // K
    }))
    .filter((r) => normalizeComparison(r.artista) === normAlvo);

  const dadosLinha = dadosRows.find((r) => normalizeComparison(r?.[0]) === normAlvo);
  const dados = dadosLinha
    ? {
        artista: normalizeText(dadosLinha[0]),
        ad_saldoOriginal: normalizeText(dadosLinha[1]),
        ah: normalizeText(dadosLinha[5]),
        ai_saldoAoVivo: normalizeText(dadosLinha[6]),
      }
    : null;

  return new Response(
    JSON.stringify({ success: true, data: { banners, ecoinLinhasDoArtista, dados } }, null, 2),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
}

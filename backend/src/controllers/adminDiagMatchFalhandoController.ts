import { googleSheetsService, normalizeComparison, normalizeText } from "../services/googleSheetsService";

// Usuário confirmou: existem lançamentos reais entre 30/09 e 21/10 (Rayna,
// LOREENA, TED, Brida...) que deveriam aparecer em Lançamentos Recentes
// antes do single antigo "Follia", mas não aparecem — o match desses
// candidatos contra o catálogo (Musicas) está falhando silenciosamente.
// getEmpirePlayLancamentosRecentesController filtra Musicas por
// pendente!="Sim" ANTES de montar o mapa código->item — se uma dessas
// faixas ainda estiver marcada pendente, ela some do mapa e o candidato
// é pulado sem erro. Dump das linhas de Musicas pra cada Código único
// reportado como "no gap" (vindo de EDIÇÃO CHARTS), com pendente/id do
// tópico, pra confirmar essa hipótese antes de mexer em código.
//
// GET /api/empire-play/admin/diagnostico-match-falhando
export async function adminDiagMatchFalhandoController(): Promise<Response> {
  const CODIGOS = [
    "EMP686", "EMP931", "EMP932", "EMP933", "EMP934", "EMP935", "EMP936",
    "EMP937", "EMP938", "EMP940", "EMP941", "EMP942", "EMP943", "EMP944",
    "EMP945", "EMPALBM089",
  ];

  const musicasRows = await googleSheetsService.principal.readValues("Musicas", "A1:AE2000").catch(() => []);
  const albunsRows = await googleSheetsService.principal.readValues("Albuns", "A1:L200").catch(() => []);

  const achadasMusicas: Record<string, unknown>[] = [];
  for (let i = 1; i < musicasRows.length; i++) {
    const row = musicasRows[i];
    if (!row) continue;
    const codigo = normalizeText(row[25]);
    if (!CODIGOS.includes(codigo)) continue;
    achadasMusicas.push({
      linha: i + 1,
      H_titulo: normalizeText(row[7]),
      K_album: normalizeText(row[10]),
      X_pendente: normalizeText(row[23]),
      Z_codigoUnico: codigo,
    });
  }

  const achadasAlbuns: Record<string, unknown>[] = [];
  for (let i = 1; i < albunsRows.length; i++) {
    const row = albunsRows[i];
    if (!row) continue;
    const codigo = normalizeText(row[11]);
    if (!CODIGOS.includes(codigo)) continue;
    achadasAlbuns.push({ linha: i + 1, G_novoNome: normalizeText(row[6]), L_codigoUnico: codigo });
  }

  const codigosEncontrados = new Set([
    ...achadasMusicas.map((a) => (a as any).Z_codigoUnico),
    ...achadasAlbuns.map((a) => (a as any).L_codigoUnico),
  ]);
  const codigosFaltando = CODIGOS.filter((c) => !codigosEncontrados.has(c));

  return new Response(
    JSON.stringify({ success: true, achadasMusicas, achadasAlbuns, codigosFaltando }, null, 2),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
}

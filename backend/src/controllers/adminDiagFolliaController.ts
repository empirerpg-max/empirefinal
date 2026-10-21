import { googleSheetsService, normalizeText, normalizeComparison } from "../services/googleSheetsService";

// Diagnóstico read-only: usuário reportou múltiplos álbuns "FOLLIA" (Max
// Gorghan) duplicados no Fórum > Álbuns, mesmo após o fix do
// withWriteLock em processarLancamentosPreSaveScheduled (deploy
// 2026-10-21 ~11:06 UTC). Dump de TODAS as linhas de "Albuns" cujo
// título/artista batem, com o topicId (que embute Date.now() de quando
// foi gravado — "album_<timestampMs>_<rand>") pra saber se as duplicatas
// são de ANTES do fix (histórico, precisa limpar manualmente) ou se
// continuam sendo criadas DEPOIS do fix (fix não funcionou de verdade).
//
// GET /api/empire-play/admin/diagnostico-follia
export async function adminDiagFolliaController(): Promise<Response> {
  const rows = await googleSheetsService.principal.readValues("Albuns", "A1:Z20000").catch(() => []);
  const achadas: Record<string, unknown>[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    // Layout real de Albuns!A:K (ver publicarAlbum em gestaoController.ts):
    // A=Data, B=ID do tópico, C=Capa, D=Comentários para, E=ID Criador,
    // F=Nome criador, G=Novo Nome ("Artista - Título"), H/I=metacritic,
    // J=Encarte, K=Tipo.
    const novoNome = normalizeText(row[6]);
    if (normalizeComparison(novoNome) !== normalizeComparison("Max Gorghan - Follia")) continue;
    const topicId = normalizeText(row[1]);
    const match = /^album_(\d+)_/.exec(topicId);
    const timestampMs = match ? Number(match[1]) : null;
    achadas.push({
      linha: i + 1,
      topicId,
      novoNome,
      dataLancamento: normalizeText(row[0]),
      criadoEm: timestampMs ? new Date(timestampMs).toISOString() : null,
      depoisDoFix: timestampMs ? timestampMs > Date.parse("2026-10-21T11:06:00Z") : null,
    });
  }

  const presaveRows = await googleSheetsService.principal
    .readValues("PreSave_Album", "A1:U2000")
    .catch(() => []);
  const campanhasFollia: Record<string, unknown>[] = [];
  for (let i = 1; i < presaveRows.length; i++) {
    const row = presaveRows[i];
    if (!row) continue;
    if (normalizeComparison(normalizeText(row[4])) !== normalizeComparison("Max Gorghan - Follia")) continue;
    campanhasFollia.push({
      linha: i + 1,
      id: normalizeText(row[0]),
      albumTituloFull: normalizeText(row[4]),
      status: normalizeText(row[12]),
      dataLancamento: normalizeText(row[9]),
      codigoUnicoAlbum: normalizeText(row[16]),
    });
  }

  return new Response(
    JSON.stringify(
      { success: true, totalAlbuns: achadas.length, achadas, campanhasFollia },
      null,
      2,
    ),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
}

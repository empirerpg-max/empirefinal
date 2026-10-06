import { googleSheetsService, normalizeText } from "../services/googleSheetsService";

// Backfill (idempotente): gera um "ID do tópico" estável pra toda linha de
// Musicas que ainda não tem um — mesmo formato/gerador já usado em
// forumController.ts (createCommentController) quando alguém comenta pela
// primeira vez numa linha sem ID. Antes desse backfill, uma música só
// ganhava ID estável no momento do PRIMEIRO comentário; até lá, o link/URL
// dela no catálogo caía no fallback por índice de leitura (instável, muda
// sozinho se uma linha for inserida/removida antes). Diagnóstico ao vivo
// (2026-10-06) achou 551 músicas nessa situação — Music Videos e Albuns já
// têm 100% das linhas com ID estável, só Musicas ficou pra trás.
//
// GET  /api/empire-play/admin/backfill-ids-musicas            → simulação (não escreve)
// POST /api/empire-play/admin/backfill-ids-musicas?confirmar=1 → aplica de verdade
export async function adminBackfillTopicIdsController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const confirmar = url.searchParams.get("confirmar") === "1";

  const rows = await googleSheetsService.principal.readValues("Musicas", "A:AA").catch(() => []);
  if (!rows || rows.length < 2) {
    return new Response(JSON.stringify({ success: false, error: "Aba Musicas vazia ou inacessível." }), {
      status: 500,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  const colTopicIdIndex = 1; // B — "ID do tópico"
  const colTituloIndex = 7; // H — "Nome da música"

  const atualizadas: { linha: number; titulo: string; novoId: string }[] = [];
  const falharam: { linha: number; titulo: string }[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] || [];
    if (!row.some((c) => normalizeText(c))) continue; // linha vazia, ignora
    const jaTemId = normalizeText(row[colTopicIdIndex]);
    if (jaTemId) continue;

    const titulo = normalizeText(row[colTituloIndex]) || `linha_${i + 1}`;
    const novoId = `musica_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    if (confirmar) {
      // updateValues agora devolve se a escrita de fato persistiu (com
      // retry) — só conta como "atualizada" quando confirmado. Rajada
      // anterior sem isso perdia escritas silenciosamente por rate limit
      // da API do Sheets (confirmado ao vivo: 509 reportadas, menos da
      // metade realmente gravadas).
      const ok = await googleSheetsService.principal.updateValues("Musicas", `B${i + 1}`, [[novoId]]);
      if (ok) {
        atualizadas.push({ linha: i + 1, titulo, novoId });
      } else {
        falharam.push({ linha: i + 1, titulo });
      }
    } else {
      atualizadas.push({ linha: i + 1, titulo, novoId });
    }
  }

  return new Response(
    JSON.stringify({
      success: true,
      modo: confirmar ? "aplicado" : "simulacao",
      totalAtualizadas: atualizadas.length,
      totalFalharam: falharam.length,
      falharam: falharam.slice(0, 30),
      amostra: atualizadas.slice(0, 30),
    }),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
}

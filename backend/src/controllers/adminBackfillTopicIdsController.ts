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

  const pendentes: { linha: number; titulo: string; novoId: string }[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] || [];
    if (!row.some((c) => normalizeText(c))) continue; // linha vazia, ignora
    const jaTemId = normalizeText(row[colTopicIdIndex]);
    if (jaTemId) continue;

    const titulo = normalizeText(row[colTituloIndex]) || `linha_${i + 1}`;
    const novoId = `musica_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    pendentes.push({ linha: i + 1, titulo, novoId });
  }

  const atualizadas: { linha: number; titulo: string; novoId: string }[] = [];
  const falharam: { linha: number; titulo: string }[] = [];

  if (confirmar) {
    // Grava em LOTES via values:batchUpdate (uma viagem de rede por lote de
    // 100, em vez de uma por linha) — uma escrita de cada vez pra ~460
    // linhas nunca termina dentro dos 45s do admin-call.yml (confirmado ao
    // vivo, 2026-10-06: 3 tentativas, todas "0 bytes received" por timeout).
    // Mesma lição já aplicada na migração pro D1 (db.batch()).
    const tamanhoLote = 100;
    for (let i = 0; i < pendentes.length; i += tamanhoLote) {
      const lote = pendentes.slice(i, i + tamanhoLote);
      const ok = await googleSheetsService.principal.updateValuesBatch(
        lote.map((p) => ({ sheetName: "Musicas", range: `B${p.linha}`, values: [[p.novoId]] })),
      );
      if (ok) {
        atualizadas.push(...lote);
      } else {
        falharam.push(...lote.map((p) => ({ linha: p.linha, titulo: p.titulo })));
      }
    }
  } else {
    atualizadas.push(...pendentes);
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

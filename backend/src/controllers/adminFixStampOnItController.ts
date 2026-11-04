import { googleSheetsService, normalizeComparison } from "../services/googleSheetsService";

// Corrige "Stamp On It" (Angela, Anne Gray — EMP943): confirmado ao vivo
// (2026-11-04) que Musicas!B774 ("ID do tópico") está vazia na planilha de
// verdade, órfã dos 6 comentários reais salvos contra
// "musica_1791900973257_xyrbhn" (confirmado via
// admin/diag-comentario-por-topico) — bug antigo, anterior a qualquer
// correção desta sessão, só exposto agora pelo caminho rápido de leitura.
// Também grava F774 ("Comentários para"), mesma convenção das outras
// linhas. Depois de rodar com confirmar=1, rodar
// /admin/migrar-musicas-d1 e /admin/migrar-comentarios-musicas-d1 pra
// sincronizar o D1 com o valor corrigido.
//
// GET /api/empire-play/admin/fix-stamp-on-it?confirmar=1
export async function adminFixStampOnItController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const confirmar = url.searchParams.get("confirmar") === "1";
  const CODIGO = "emp943";
  const TOPIC_ID_CORRETO = "musica_1791900973257_xyrbhn";

  const rows = await googleSheetsService.principal.readValues("Musicas", "A1:AE2000").catch(() => []);
  let linha = -1;
  for (let i = 1; i < rows.length; i++) {
    if (normalizeComparison(rows[i]?.[25]) === CODIGO) {
      linha = i + 1;
      break;
    }
  }

  if (linha === -1) {
    return new Response(JSON.stringify({ success: false, error: "Linha EMP943 não encontrada." }), {
      status: 404,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  const topicIdAtual = rows[linha - 1]?.[1] || "";

  if (!confirmar) {
    return new Response(
      JSON.stringify({ success: true, confirmar, linha, topicIdAtual, topicIdCorreto: TOPIC_ID_CORRETO }, null, 2),
      { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  }

  const okB = await googleSheetsService.principal.updateValues("Musicas", `B${linha}:B${linha}`, [[TOPIC_ID_CORRETO]]);
  const okF = await googleSheetsService.principal.updateValues("Musicas", `F${linha}:F${linha}`, [[TOPIC_ID_CORRETO]]);

  return new Response(
    JSON.stringify({ success: true, confirmar, linha, topicIdAtual, topicIdCorreto: TOPIC_ID_CORRETO, gravados: { B: okB, F: okF } }, null, 2),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
}

import { googleSheetsService, normalizeText } from "../services/googleSheetsService";

// Correção retroativa: os comentários do Daniel (linha 1136) e do Wesley
// (linha 1139) no tópico de "nostalgic traveller" (TED) foram salvos com
// "musicas_musica_1792252409065_63282h" na coluna A (ID do tópico) — o
// PREFIXO "musicas_" não deveria estar lá. Causa: quando eles comentaram,
// o tópico dava 404 (bug da linha fantasma em Musicas, já corrigido), então
// o frontend caía no fallback `selectedTopic.id` (que inclui o prefixo da
// aba) em vez do `media.topicId` resolvido pelo backend (sem prefixo).
// Com o tópico resolvendo certo agora, esses 2 comentários continuavam
// invisíveis porque o valor salvo não bate com o topicId real.
//
// GET /api/empire-play/admin/fix-topicid-comentarios-ted?dryRun=1
const TOPIC_ID_CORRETO = "musica_1792252409065_63282h";
const LINHAS = [1136, 1139];

export async function adminFixTopicIdComentariosTedController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const dryRun = url.searchParams.get("dryRun") === "1";

  const rows = await googleSheetsService.principal.readValues("Comentarios_Musicas").catch(() => []);
  const detalhe = LINHAS.map((linha1Based) => ({
    linha: linha1Based,
    topicIdAntes: normalizeText(rows[linha1Based - 1]?.[0]),
    jogador: normalizeText(rows[linha1Based - 1]?.[2]),
  }));

  if (dryRun) {
    return new Response(JSON.stringify({ success: true, dryRun: true, detalhe }, null, 2), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  for (const linha of LINHAS) {
    await googleSheetsService.principal.updateValues("Comentarios_Musicas", `A${linha}`, [[TOPIC_ID_CORRETO]]);
  }

  return new Response(JSON.stringify({ success: true, corrigido: true, detalhe }, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

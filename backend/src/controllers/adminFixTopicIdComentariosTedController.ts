import { googleSheetsService, normalizeText } from "../services/googleSheetsService";

// Correção retroativa: os comentários do Daniel e do Wesley no tópico de
// "nostalgic traveller" (TED) foram salvos com
// "musicas_musica_1792252409065_63282h" na coluna A (ID do tópico) — o
// PREFIXO "musicas_" não deveria estar lá. Causa: quando eles comentaram,
// o tópico dava 404 (bug da linha fantasma em Musicas, já corrigido), então
// o frontend caía no fallback `selectedTopic.id` (que inclui o prefixo da
// aba) em vez do `media.topicId` resolvido pelo backend (sem prefixo).
// Com o tópico resolvendo certo agora, esses 2 comentários continuavam
// invisíveis porque o valor salvo não bate com o topicId real.
//
// Número de linha NUNCA é confiável de uma rodada pra outra nessa aba —
// a limpeza de duplicatas feita antes (adminLimparComentariosTedController)
// já deslocou a linha do Wesley de 1139 pra 1137 por apagar 2 linhas acima
// dela. Por isso essa correção acha a linha por CONTEÚDO (jogador + topicId
// com o prefixo errado), não por número fixo — e só escreve se achar
// exatamente 1 match por jogador, pra nunca arriscar sobrescrever a linha
// errada se a planilha mudar de novo entre o dry run e a execução real.
//
// GET /api/empire-play/admin/fix-topicid-comentarios-ted?dryRun=1
const TOPIC_ID_ERRADO = "musicas_musica_1792252409065_63282h";
const TOPIC_ID_CORRETO = "musica_1792252409065_63282h";
const JOGADORES_ESPERADOS = ["Daniel", "Wesley"];

export async function adminFixTopicIdComentariosTedController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const dryRun = url.searchParams.get("dryRun") === "1";

  const rows = await googleSheetsService.principal.readValues("Comentarios_Musicas").catch(() => []);
  const linhasAchadas: { linha: number; jogador: string }[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    if (normalizeText(row[0]) !== TOPIC_ID_ERRADO) continue;
    linhasAchadas.push({ linha: i + 1, jogador: normalizeText(row[2]) });
  }

  const linhasParaCorrigir = linhasAchadas.filter((l) => JOGADORES_ESPERADOS.includes(l.jogador));
  const jogadoresAchados = linhasParaCorrigir.map((l) => l.jogador);
  const faltando = JOGADORES_ESPERADOS.filter((j) => !jogadoresAchados.includes(j));

  if (dryRun) {
    return new Response(
      JSON.stringify({ success: true, dryRun: true, linhasAchadas, linhasParaCorrigir, faltando }, null, 2),
      { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  }

  if (faltando.length > 0 || linhasParaCorrigir.length !== JOGADORES_ESPERADOS.length) {
    return new Response(
      JSON.stringify({
        success: false,
        error: "Não achou exatamente 1 linha por jogador esperado — abortado sem escrever nada.",
        linhasAchadas,
        linhasParaCorrigir,
        faltando,
      }),
      { status: 409, headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  }

  for (const { linha } of linhasParaCorrigir) {
    await googleSheetsService.principal.updateValues("Comentarios_Musicas", `A${linha}`, [[TOPIC_ID_CORRETO]]);
  }

  return new Response(JSON.stringify({ success: true, corrigido: true, linhasParaCorrigir }, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

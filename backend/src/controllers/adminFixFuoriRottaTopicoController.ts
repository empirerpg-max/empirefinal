import { googleSheetsService, normalizeText } from "../services/googleSheetsService";

// Reversão de emergência: uma correção anterior (mal informada — achava
// que a linha "Fuori Rotta" original estava sem ID de tópico, quando na
// verdade só os remixes é que estavam) escreveu por engano o MESMO ID de
// tópico órfão ("musica_1788994568297_j04lhl") nas 4 linhas de remix
// (440-443), fazendo elas compartilharem indevidamente o mesmo tópico de
// comentários. Essa rota limpa de volta a coluna B (ID do tópico) só
// dessas 4 linhas específicas, restaurando o estado "vazio" original —
// deixa o próprio forumController gerar um ID novo e único da próxima vez
// que alguém comentar em cada uma, que é o comportamento correto.
const LINHAS_PARA_REVERTER = [440, 441, 442, 443];
const ID_ESCRITO_POR_ENGANO = "musica_1788994568297_j04lhl";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

export async function adminFixFuoriRottaTopicoController(): Promise<Response> {
  const resultados = [];
  for (const linha of LINHAS_PARA_REVERTER) {
    const atual = await googleSheetsService.principal.readValues("Musicas", `B${linha}:H${linha}`);
    const valorAtual = normalizeText(atual?.[0]?.[0] || "");
    const titulo = normalizeText(atual?.[0]?.[6] || "");
    if (valorAtual !== ID_ESCRITO_POR_ENGANO) {
      resultados.push({ linha, titulo, valorAtual, acao: "nada_a_fazer" });
      continue;
    }
    await googleSheetsService.principal.updateValues("Musicas", `B${linha}`, [[""]]);
    resultados.push({ linha, titulo, valorAtual, acao: "revertido_para_vazio" });
  }
  return jsonResponse({ success: true, data: resultados });
}

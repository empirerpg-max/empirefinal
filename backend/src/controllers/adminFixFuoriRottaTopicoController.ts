import { googleSheetsService, normalizeText } from "../services/googleSheetsService";

// Causa raiz real do bug "Fuori Rotta sem comentários": a linha 421 de
// Musicas guarda o título como só "Fuori Rotta" em H, sem o prefixo
// "Artista - " que toda linha da aba deveria ter (ver dedupeArtistPrefix
// em gestaoController.ts, comentário confirma a convenção). Por isso
// adminFixOrphanCommentsController nunca conseguia casar essa música com
// as notificações registradas como "Max Gorghan - Fuori Rotta" — o título
// buscado não batia com o título real da linha — e os comentários
// antigos ficaram órfãos pra sempre. Corrige só o título (não mexe no ID
// do tópico, que já está correto: musica_1790123495658_2ev9gn); depois
// disso, rodar de novo /api/empire-play/admin/fix-orphan-comments religa
// os comentários automaticamente.
const LINHA = 421;
const TITULO_ESPERADO = "Max Gorghan - Fuori Rotta";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

export async function adminFixFuoriRottaTopicoController(): Promise<Response> {
  const atual = await googleSheetsService.principal.readValues("Musicas", `A${LINHA}:H${LINHA}`);
  const row = atual?.[0] || [];
  const tituloAtual = normalizeText(row[7] || "");
  const topicIdAtual = normalizeText(row[1] || "");

  if (tituloAtual === TITULO_ESPERADO) {
    return jsonResponse({ success: true, data: { linha: LINHA, tituloAtual, topicIdAtual, acao: "ja_estava_correto" } });
  }

  await googleSheetsService.principal.updateValues("Musicas", `H${LINHA}`, [[TITULO_ESPERADO]]);

  return jsonResponse({
    success: true,
    data: { linha: LINHA, tituloAntigo: tituloAtual, tituloNovo: TITULO_ESPERADO, topicIdAtual, acao: "titulo_corrigido" },
  });
}

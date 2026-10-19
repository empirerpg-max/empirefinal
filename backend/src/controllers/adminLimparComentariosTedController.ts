import { googleSheetsService, normalizeText } from "../services/googleSheetsService";

// Correção pontual pedida pelo usuário: no tópico de "nostalgic traveller"
// (TED), o comentário do Wesley (idêntico, reenviado) e um dos dois do
// Daniel (reescrito com leves diferenças no reenvio — não bate por texto
// exato) ficaram duplicados, e tem um comentário de teste do Hugo ("Teste
// típico TED") sobrando. Reenvios provavelmente aconteceram enquanto o
// tópico dava 404 (antes da correção retroativa de Musicas), achando que
// não tinha ido.
//
// BUG na 1ª versão desse controller: supunha que a coluna A fosse o
// topicId puro ("musica_..."), mas o valor real gravado lá é
// "musicas_musica_..." (com o prefixo "musicas_" do buildCleanItem) —
// por isso a busca por igualdade exata vinha sempre vazia. Confirmado
// via /admin/diagnostico-comentarios-ted (dump cru por texto): as 5
// linhas do tópico são 1136-1140. Como o reenvio do Daniel foi
// reescrito (não é cópia exata), a lista de linhas a apagar é fixa aqui
// em vez de detectada por igualdade de texto.
//
// GET /api/empire-play/admin/limpar-comentarios-ted?dryRun=1 — só lista o
// que seria apagado, sem apagar.
// GET /api/empire-play/admin/limpar-comentarios-ted — apaga de verdade.
const LINHAS_PARA_APAGAR = [1137, 1138, 1140]; // Daniel (reenvio reescrito), Hugo (teste), Wesley (reenvio idêntico)

export async function adminLimparComentariosTedController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const dryRun = url.searchParams.get("dryRun") === "1";

  const rows = await googleSheetsService.principal.readValues("Comentarios_Musicas").catch(() => []);
  const detalhe = LINHAS_PARA_APAGAR.map((linha1Based) => {
    const row = rows[linha1Based - 1];
    return {
      linha: linha1Based,
      jogadorId: normalizeText(row?.[1]),
      nome: normalizeText(row?.[2]),
      comentario: normalizeText(row?.[3]).slice(0, 80),
    };
  });

  if (dryRun) {
    return new Response(
      JSON.stringify({ success: true, dryRun: true, linhasParaApagar: LINHAS_PARA_APAGAR, detalhe }, null, 2),
      { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  }

  await googleSheetsService.principal.deleteRows("Comentarios_Musicas", LINHAS_PARA_APAGAR);

  return new Response(
    JSON.stringify({ success: true, apagado: true, linhasApagadas: LINHAS_PARA_APAGAR, detalhe }, null, 2),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
}

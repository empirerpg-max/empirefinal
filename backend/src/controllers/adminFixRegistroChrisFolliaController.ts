import { gravarLinhaRegistro } from "./registroLogController";

// Correção retroativa pontual: o comentário do Chris em "Follia" (Max
// Gorghan, EMP930, linha 760 de Musicas — música normal, já lançada,
// pendente="Não", topicId bate exatamente com o comentário) nunca gerou
// entrada em REGISTRO. Confirmado via /admin/diagnostico-faixa-pendente
// ?titulo=Follia (linha saudável) cruzado com
// /admin/diagnostico-comentarios-chris (linha 1140, 20/10/2026 16:05:59).
// Não é a mesma classe de bug já corrigida (linha fantasma/faixa
// pendente vazada) — provável falha transitória de escrita no Sheets
// (gravarLinhaRegistro só tenta 3x e desiste em silêncio). Só grava a
// linha que faltou, sem alterar nenhuma lógica compartilhada.
//
// GET /api/empire-play/admin/fix-registro-chris-follia
export async function adminFixRegistroChrisFolliaController(): Promise<Response> {
  const ok = await gravarLinhaRegistro([
    "Chris",
    "Max Gorghan - Follia",
    "COMENTÁRIOS (SINGLES, VÍDEOS, MÚSICAS)",
  ]);

  return new Response(JSON.stringify({ success: ok, gravado: ok }, null, 2), {
    status: ok ? 200 : 500,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

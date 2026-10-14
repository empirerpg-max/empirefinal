import { registrarAuditLog } from "./registroLogController";

// Correção pontual (2026-10-14): comentário do jogador "Hugo" em "Dagny -
// JULY (MTV 00's Version)" (música, Código único EMP929) foi salvo em
// Comentarios_Musicas e teve a nota computada (Metacritic por jogador:
// "...Hugo: 77"), mas o Audit Log em REGISTRO nunca foi gravado — causa
// raiz: tentativa de correção em forumController.ts (commit 67080f5,
// revertido em ed698b8) que tirou o passo 3 (Audit Log/Prestígio) do
// `await` antes de responder; sem `ctx.waitUntil` disponível nessa camada,
// o Cloudflare matou a isolate assim que a resposta saiu, perdendo a
// escrita em background. Confirmado via
// /api/empire-play/admin/diagnostico-comentario-perdido?musica=July: só
// existe 1 linha em REGISTRO pra essa música (Weuller, anterior ao
// incidente) — nenhuma pro Hugo.
//
// Reaproveita a MESMA função usada pelo fluxo normal de comentário
// (registrarAuditLog, forumController.ts) — nunca escreve direto na
// planilha com um formato ad-hoc. Rota de uso único, não genérica: fixa
// os parâmetros desse caso específico, sem querystring.
export async function adminFixComentarioAuditLogJulyHugoController(): Promise<Response> {
  try {
    await registrarAuditLog({
      nomeJogador: "Hugo",
      titulo: "Dagny - JULY (MTV 00's Version)",
      tipo: "COMENTÁRIOS (SINGLES, VÍDEOS, MÚSICAS)",
      isAlbum: false,
      codigoUnico: "EMP929",
    });
    return new Response(
      JSON.stringify({ success: true, mensagem: "Audit Log do comentário do Hugo em July gravado em REGISTRO." }),
      { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ success: false, error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  }
}

import { getEmpirePlayForumTopicController } from "./empirePlayController";

// Diagnóstico pontual (2026-11-10): o /api/empire-play/forum/albuns/<topicId>
// real do FOLLIA devolveu 404 "Tópico não encontrado" quando chamado via
// admin-call.yml, mas o curl+jq do workflow crashava antes de mostrar o corpo
// da resposta (não era JSON válido pro jq nalgum caso de erro 500/523). Chama
// o controller direto aqui (sem HTTP de verdade) e devolve status+corpo cru
// como string dentro de um JSON garantidamente válido, pra nunca mais perder
// o corpo real do erro.
// GET /api/empire-play/admin/teste-forum-follia
export async function adminTesteForumFolliaController(): Promise<Response> {
  const fakeReq = new Request(
    "https://x/api/empire-play/forum/albuns/album_1792551638543_utb9mi",
  );
  let status = 0;
  let body = "";
  let erro = "";
  try {
    const resp = await getEmpirePlayForumTopicController(fakeReq, {
      tipo: "albuns",
      topicId: "album_1792551638543_utb9mi",
    });
    status = resp.status;
    body = await resp.text();
  } catch (e) {
    erro = e instanceof Error ? `${e.message}\n${e.stack}` : String(e);
  }
  return new Response(JSON.stringify({ success: true, status, body, erro }, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

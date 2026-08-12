import { getNivelAtual } from "../services/prestigioService";

/**
 * GET /api/user/nivel?telegramId=... ou ?usuario=...
 * Devolve nível/badge/progresso de gamificação do jogador, calculado a
 * partir do prestígio acumulado (aba "Usuários") contra os limiares da aba
 * "Níveis" — ambas 100% editáveis pela planilha, sem deploy.
 */
export async function getNivelController(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const telegramId = url.searchParams.get("telegramId") || undefined;
    const usuario = url.searchParams.get("usuario") || undefined;

    if (!telegramId && !usuario) {
      return new Response(JSON.stringify({ success: false, error: "Informe telegramId ou usuario." }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const data = await getNivelAtual({ telegramId, usuario });

    return new Response(JSON.stringify({ success: true, data }), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  } catch (error: any) {
    console.error("[getNivelController] Erro:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message || "Erro ao calcular nível." }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}

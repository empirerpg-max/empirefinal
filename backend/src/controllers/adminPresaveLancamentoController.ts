// Estado do lançamento em passos de uma campanha de pre-save (só leitura).
// GET /api/presave/admin/lancamento?campanhaId=PRESAVE-xxxx
import * as DB from "../services/presaveLancamentoDb";

export async function statusLancamento(
  campanhaId: string,
): Promise<{ campanhaId: string; existe: boolean; completo: boolean; passos: DB.Passo[] }> {
  const l = await DB.obterLancamento(campanhaId);
  if (!l) return { campanhaId, existe: false, completo: false, passos: [] };
  return { campanhaId, existe: true, completo: l.completo, passos: await DB.listarPassos(campanhaId) };
}

export async function adminPresaveLancamentoController(request: Request): Promise<Response> {
  const campanhaId = (new URL(request.url).searchParams.get("campanhaId") || "").trim();
  const headers = { "Content-Type": "application/json; charset=utf-8" };
  if (!campanhaId) {
    return new Response(JSON.stringify({ success: false, error: "Parâmetro 'campanhaId' é obrigatório." }), {
      status: 400,
      headers,
    });
  }
  try {
    return new Response(JSON.stringify({ success: true, ...(await statusLancamento(campanhaId)) }, null, 2), {
      status: 200,
      headers,
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ success: false, error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers },
    );
  }
}

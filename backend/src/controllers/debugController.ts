const TV_SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycby7OeFYuai1QoTEXD427-Kn_2KBvh3nakD4iKSuOji9-i3x7sK8DD59BHRBRc5Ow1YB/exec";

// TEMPORÁRIO — investiga por que /tv está mostrando "catálogo ainda não
// chegou" (a chamada listar_programas_tv pro Apps Script da Agenda_TV).
export async function debugTvCatalogoController(): Promise<Response> {
  try {
    const res = await fetch(`${TV_SCRIPT_URL}?acao=listar_programas_tv`);
    const text = await res.text();
    return new Response(
      JSON.stringify({
        status: res.status,
        ok: res.ok,
        contentType: res.headers.get("content-type"),
        bodyPreview: text.slice(0, 2000),
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ erro: err?.message || String(err) }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
}

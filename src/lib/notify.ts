import { toast } from "sonner";

/**
 * Mostra o resultado de uma ação do Apps Script como toast bonito.
 * O backend retorna strings tipo "✅ ...", "❌ ...", "⚠️ ..." ou JSON com {ok, msg}.
 * Esconde códigos UUID e ruído técnico.
 */
export function notify(result: unknown, opts: { successFallback?: string } = {}) {
  let msg = "";
  if (typeof result === "string") {
    msg = result;
  } else if (result && typeof result === "object") {
    const res = result as Record<string, unknown>;
    if (res.erro) msg = "❌ " + String(res.erro);
    else if (res.message) msg = String(res.message);
    else if (res.msg) msg = String(res.msg);
    else if (res.ok === true) msg = "✅ " + (opts.successFallback || "Feito!");
    else if (res.ok === false) msg = "❌ " + (String(res.msg) || "Falhou.");
    else msg = opts.successFallback || "Feito!";
  }

  // limpa: remove IDs longos (UUIDs e similares) que vazam pro usuário
  const clean = msg.replace(/\b[a-f0-9]{8}\b/gi, "").trim();

  // separa título (primeira linha) das demais (vão como description)
  const lines = clean.split(/\n+/).filter(Boolean);
  const title = lines[0] || "Feito";
  const description = lines.slice(1).join("\n") || undefined;

  if (title.startsWith("❌")) {
    toast.error(title.replace(/^❌\s*/, ""), { description });
  } else if (title.startsWith("⚠️")) {
    toast.warning(title.replace(/^⚠️\s*/, ""), { description });
  } else if (title.startsWith("✅")) {
    toast.success(title.replace(/^✅\s*/, ""), { description });
  } else {
    toast(title, { description });
  }

  return { ok: title.startsWith("✅"), title, description };
}

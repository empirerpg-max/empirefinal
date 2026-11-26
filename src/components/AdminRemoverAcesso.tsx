import { useEffect, useState } from "react";
import { Ban, Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { getStoredSessionToken } from "@/components/LoginScreen";

interface UsuarioBloqueado {
  id: string;
  usuario: string;
  em: string;
}

async function chamar(path: string, body?: unknown) {
  const res = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getStoredSessionToken() || ""}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (!json?.success) throw new Error(json?.error || "Falha na operação.");
  return json;
}

/**
 * Painel admin "Remover acesso": bloqueia um jogador (desloga na hora em
 * todos os aparelhos dele no próximo heartbeat — até 3 min ou ao reabrir o
 * app — e recusa qualquer ação em nome dele) e permite devolver o acesso.
 * Não apaga nada da planilha.
 */
export function AdminRemoverAcesso() {
  const [alvo, setAlvo] = useState("");
  const [lista, setLista] = useState<UsuarioBloqueado[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    chamar("/api/auth/admin/bloqueados")
      .then((j) => setLista(j.data || []))
      .catch(() => {});
  }, []);

  async function bloquear() {
    const nome = alvo.trim();
    if (!nome) return;
    if (
      !window.confirm(
        `Remover o acesso de "${nome}"? A pessoa será deslogada e não conseguirá mais entrar.`,
      )
    )
      return;
    setCarregando(true);
    setErro(null);
    try {
      const j = await chamar("/api/auth/admin/bloquear", { usuario: nome });
      setLista(j.data || []);
      setAlvo("");
      toast.success(
        j.encontradoNaPlanilha
          ? `Acesso de "${nome}" removido.`
          : `"${nome}" não está mais na planilha, mas foi bloqueado mesmo assim.`,
      );
    } catch (e: unknown) {
      setErro((e instanceof Error && e.message) || "Falha ao remover acesso.");
    } finally {
      setCarregando(false);
    }
  }

  async function desbloquear(b: UsuarioBloqueado) {
    const chave = b.usuario || b.id;
    if (!window.confirm(`Devolver o acesso de "${chave}"?`)) return;
    try {
      const j = await chamar("/api/auth/admin/desbloquear", { usuario: chave });
      setLista(j.data || []);
      toast.success(`Acesso de "${chave}" devolvido.`);
    } catch (e: unknown) {
      toast.error((e instanceof Error && e.message) || "Falha ao devolver acesso.");
    }
  }

  return (
    <div className="p-4 rounded-2xl bg-white/[0.02] border border-red-500/20 space-y-2.5">
      <div className="flex items-center gap-2 min-w-0">
        <Ban className="size-4 text-red-400 shrink-0" />
        <span className="font-black uppercase text-xs tracking-widest truncate">
          Remover acesso de jogador (admin)
        </span>
      </div>
      <div className="flex items-center gap-2">
        <input
          value={alvo}
          onChange={(e) => setAlvo(e.target.value)}
          placeholder="usuário ou ID do jogador"
          className="min-w-0 flex-1 px-3 py-2.5 rounded-xl bg-black/30 border border-white/10 text-xs text-white placeholder:text-muted-foreground focus:outline-none focus:border-red-400/50"
        />
        <button
          onClick={bloquear}
          disabled={carregando || !alvo.trim()}
          className="shrink-0 px-4 py-2.5 rounded-xl bg-red-500 text-white font-black text-xs uppercase tracking-widest disabled:opacity-50"
        >
          {carregando ? <Loader2 className="size-3.5 animate-spin" /> : "Remover"}
        </button>
      </div>
      {erro && <p className="text-[11px] text-red-400">{erro}</p>}
      {lista.length > 0 && (
        <ul className="space-y-1.5 pt-1">
          {lista.map((b) => (
            <li
              key={`${b.id}-${b.usuario}`}
              className="flex items-center gap-2 min-w-0 px-3 py-2 rounded-xl bg-black/20 border border-white/5"
            >
              <span className="min-w-0 flex-1 text-xs truncate">
                {b.usuario || "(sem nome)"}
                {b.id ? <span className="text-muted-foreground"> · ID {b.id}</span> : null}
              </span>
              <button
                onClick={() => desbloquear(b)}
                className="shrink-0 flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider text-primary hover:bg-white/5 min-w-0"
              >
                <RotateCcw className="size-3 shrink-0" />
                <span className="truncate">Devolver</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

import { useEffect, useState } from "react";
import { Tv, Loader2, ExternalLink, Rocket } from "lucide-react";
import { authHeaders, formatarDataBR } from "@/lib/api";
import { haptic } from "@/lib/telegram";

interface VideoPendente {
  id: string;
  jogadorId: string;
  jogadorNome: string;
  artista: string;
  categoria: string;
  titulo: string;
  dataPrograma: string;
  criadoEmISO: string;
  mediaUrl: string;
  capaUrl: string;
}

// Fila de aprovação da Empire TV — vídeos (Music Video/Comercial/
// Performance) que o jogador marcou "Lançar em um programa dessa semana?"
// na Gestão. Ficam invisíveis pra todo mundo até o Admin publicar aqui —
// publicar roda a MESMA lógica de sempre (criarVideoNoCatalogo), sempre em
// nome do jogador/artista que enviou, nunca do Admin.
export function GestaoEmpireTv() {
  const [pendentes, setPendentes] = useState<VideoPendente[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [publicandoId, setPublicandoId] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  function carregar() {
    setLoading(true);
    setErro(null);
    fetch("/api/gestao/admin/empire-tv-pendentes", { headers: authHeaders() })
      .then((r) => r.json())
      .then((data) => {
        if (data?.success) setPendentes(data.data || []);
        else setErro(data?.error || "Erro ao carregar pendentes.");
      })
      .catch(() => setErro("Erro ao carregar pendentes."))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    carregar();
  }, []);

  async function publicar(id: string) {
    haptic.selection();
    setPublicandoId(id);
    setErro(null);
    setSuccessMsg(null);
    try {
      const res = await fetch("/api/gestao/admin/empire-tv-publicar", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ id }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "Erro ao publicar vídeo.");
      setSuccessMsg(`"${data.data.titulo}" publicado com sucesso!`);
      setPendentes((prev) => prev.filter((p) => p.id !== id));
    } catch (err: any) {
      setErro(err.message || "Erro ao publicar vídeo.");
    } finally {
      setPublicandoId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Tv className="size-5 text-fuchsia-400" />
        <h3 className="text-sm font-black text-white uppercase tracking-tight">
          Fila de aprovação — Empire TV
        </h3>
      </div>
      <p className="text-[11px] text-neutral-500 leading-relaxed">
        Vídeos enviados com "Lançar em um programa dessa semana?" marcado — ficam invisíveis pro
        resto do app até você publicar o tópico aqui. A publicação sempre sai em nome do jogador e
        do artista que enviou, nunca do seu usuário admin.
      </p>

      {successMsg && (
        <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/30 px-4 py-3 text-xs font-bold text-emerald-300">
          {successMsg}
        </div>
      )}
      {erro && (
        <div className="rounded-xl bg-red-500/10 border border-red-500/30 px-4 py-3 text-xs font-bold text-red-300">
          {erro}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-10 text-neutral-500">
          <Loader2 className="size-5 animate-spin" />
        </div>
      ) : pendentes.length === 0 ? (
        <div className="text-center py-10 text-neutral-500 text-xs italic">
          Nenhum vídeo pendente no momento.
        </div>
      ) : (
        <div className="space-y-3">
          {pendentes.map((p) => (
            <div
              key={p.id}
              className="rounded-2xl bg-neutral-900/60 border border-white/10 p-4 space-y-2"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <span className="inline-block px-2 py-0.5 rounded-md bg-fuchsia-500/15 text-fuchsia-300 text-[10px] font-black uppercase tracking-wider mb-1.5">
                    {p.categoria}
                  </span>
                  <h4 className="font-bold text-sm text-white truncate">{p.titulo}</h4>
                  <p className="text-[11px] text-neutral-400 truncate">
                    {p.artista} · enviado por {p.jogadorNome}
                  </p>
                  <p className="text-[11px] text-neutral-500 mt-0.5">
                    Programa: {formatarDataBR(p.dataPrograma) || p.dataPrograma}
                  </p>
                  {p.mediaUrl && (
                    <a
                      href={p.mediaUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] text-fuchsia-300 hover:text-fuchsia-200 mt-1"
                    >
                      <ExternalLink className="size-3" />
                      Abrir arquivo do vídeo
                    </a>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => publicar(p.id)}
                  disabled={publicandoId === p.id}
                  className="shrink-0 px-3.5 py-2 rounded-full bg-fuchsia-500 text-black text-[11px] font-black uppercase tracking-wider flex items-center gap-1.5 hover:bg-fuchsia-400 transition disabled:opacity-50"
                >
                  {publicandoId === p.id ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Rocket className="size-3.5" />
                  )}
                  Publicar tópico
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

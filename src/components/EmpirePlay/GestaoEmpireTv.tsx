import { useEffect, useState } from "react";
import { Tv, Loader2, ExternalLink, Rocket, Music, X } from "lucide-react";
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
  musicasVinculadas: string[];
}

interface MusicaBusca {
  title: string;
  artist: string;
}

// Fila de aprovação da Empire TV — vídeos (Music Video/Comercial/
// Performance) que o jogador marcou "Lançar em um programa dessa semana?"
// na Gestão. Ficam invisíveis pra todo mundo até o Admin publicar aqui —
// publicar roda a MESMA lógica de sempre (criarVideoNoCatalogo), sempre em
// nome do jogador/artista que enviou, nunca do Admin.
//
// Música vinculada é obrigatória pra publicar (igual sempre foi), mas o
// jogador pode ter deixado em branco ao marcar a caixinha — pedido
// explícito do usuário: nesse caso o Admin escolhe aqui antes de publicar,
// nunca sobrescrevendo uma escolha que o jogador já tinha feito.
export function GestaoEmpireTv() {
  const [pendentes, setPendentes] = useState<VideoPendente[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [publicandoId, setPublicandoId] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Seleção de música feita pelo Admin, por pendente (id -> lista de
  // "Artista - Título"), e estado da busca por pendente.
  const [musicasEscolhidas, setMusicasEscolhidas] = useState<Record<string, string[]>>({});
  const [buscaAberta, setBuscaAberta] = useState<string | null>(null);
  const [buscaQuery, setBuscaQuery] = useState("");
  const [buscaResultados, setBuscaResultados] = useState<MusicaBusca[]>([]);
  const [buscando, setBuscando] = useState(false);

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

  useEffect(() => {
    if (!buscaAberta || buscaQuery.trim().length < 2) {
      setBuscaResultados([]);
      return;
    }
    const timer = setTimeout(() => {
      setBuscando(true);
      fetch(`/api/empire-play/musicas?q=${encodeURIComponent(buscaQuery.trim())}`)
        .then((r) => r.json())
        .then((data) => {
          const lista: any[] = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : [];
          setBuscaResultados(
            lista
              .map((item) => ({ title: item.title || item.titulo || "", artist: item.artist || item.artista || "" }))
              .filter((m) => m.title),
          );
        })
        .catch(() => setBuscaResultados([]))
        .finally(() => setBuscando(false));
    }, 300);
    return () => clearTimeout(timer);
  }, [buscaQuery, buscaAberta]);

  function musicasAtuais(p: VideoPendente): string[] {
    return musicasEscolhidas[p.id] ?? p.musicasVinculadas;
  }

  function maxMusicas(p: VideoPendente): number {
    return p.categoria.trim().toLowerCase() === "music video" ? 1 : 3;
  }

  function adicionarMusica(p: VideoPendente, m: MusicaBusca) {
    const atual = musicasAtuais(p);
    if (atual.length >= maxMusicas(p)) return;
    const label = `${m.artist} - ${m.title}`;
    if (atual.includes(label)) return;
    setMusicasEscolhidas((prev) => ({ ...prev, [p.id]: [...atual, label] }));
    setBuscaAberta(null);
    setBuscaQuery("");
  }

  function removerMusica(p: VideoPendente, label: string) {
    setMusicasEscolhidas((prev) => ({ ...prev, [p.id]: musicasAtuais(p).filter((m) => m !== label) }));
  }

  async function publicar(p: VideoPendente) {
    haptic.selection();
    setPublicandoId(p.id);
    setErro(null);
    setSuccessMsg(null);
    try {
      const res = await fetch("/api/gestao/admin/empire-tv-publicar", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ id: p.id, musicasVinculadas: musicasAtuais(p) }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "Erro ao publicar vídeo.");
      setSuccessMsg(`"${data.data.titulo}" publicado com sucesso!`);
      setPendentes((prev) => prev.filter((item) => item.id !== p.id));
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
          {pendentes.map((p) => {
            const musicas = musicasAtuais(p);
            const podeAdicionar = musicas.length < maxMusicas(p);
            return (
              <div
                key={p.id}
                className="rounded-2xl bg-neutral-900/60 border border-white/10 p-4 space-y-2.5"
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
                    onClick={() => publicar(p)}
                    disabled={publicandoId === p.id || musicas.length === 0}
                    title={musicas.length === 0 ? "Escolha pelo menos uma música vinculada antes de publicar" : undefined}
                    className="shrink-0 px-3.5 py-2 rounded-full bg-fuchsia-500 text-black text-[11px] font-black uppercase tracking-wider flex items-center gap-1.5 hover:bg-fuchsia-400 transition disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {publicandoId === p.id ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Rocket className="size-3.5" />
                    )}
                    Publicar tópico
                  </button>
                </div>

                <div className="pt-1 border-t border-white/5 space-y-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-neutral-400 flex items-center gap-1.5">
                    <Music className="size-3 text-emerald-400" />
                    Música(s) vinculada(s) {musicas.length === 0 && <span className="text-amber-400">— faltando, escolha antes de publicar</span>}
                  </label>
                  {musicas.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {musicas.map((m) => (
                        <span
                          key={m}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-[11px] text-emerald-300"
                        >
                          {m}
                          <button type="button" onClick={() => removerMusica(p, m)} className="hover:text-white">
                            <X className="size-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                  {podeAdicionar && (
                    <div className="relative">
                      <input
                        type="text"
                        value={buscaAberta === p.id ? buscaQuery : ""}
                        onFocus={() => setBuscaAberta(p.id)}
                        onChange={(e) => {
                          setBuscaAberta(p.id);
                          setBuscaQuery(e.target.value);
                        }}
                        placeholder="Buscar música pra vincular..."
                        className="w-full bg-black/25 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-neutral-500 focus:border-emerald-500 focus:outline-none"
                      />
                      {buscaAberta === p.id && buscaQuery.trim().length >= 2 && (
                        <div className="absolute z-10 mt-1 w-full max-h-48 overflow-y-auto bg-neutral-900 border border-white/10 rounded-xl shadow-2xl">
                          {buscando ? (
                            <p className="px-3 py-2.5 text-[11px] text-neutral-500">Buscando...</p>
                          ) : buscaResultados.length === 0 ? (
                            <p className="px-3 py-2.5 text-[11px] text-neutral-500 italic">Nenhuma música encontrada.</p>
                          ) : (
                            buscaResultados.slice(0, 15).map((m, i) => (
                              <button
                                key={`${m.artist}-${m.title}-${i}`}
                                type="button"
                                onClick={() => adicionarMusica(p, m)}
                                className="w-full text-left px-3 py-2 text-[11px] text-white hover:bg-emerald-500/10 border-b border-white/5 last:border-b-0"
                              >
                                <span className="font-bold">{m.artist}</span> - {m.title}
                              </button>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

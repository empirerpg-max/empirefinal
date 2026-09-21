import { useEffect, useMemo, useState } from "react";
import { X, Search, Loader2, Rocket, Disc } from "lucide-react";
import { toast } from "sonner";
import { haptic } from "@/lib/telegram";

const TIPOS_SINGLE_FAIXA = [
  "TRACKLIST ALBUM",
  "LEAD SINGLE",
  "PRÉ-ALBUM",
  "AVULSO",
  "PÓS-ALBUM",
  "PÓS-ALBUM REMIX",
  "SOUNDTRACK",
  "PROMOCIONAL",
  "REMIX",
  "PRÉ-ALBUM REMIX",
  "LEAD SINGLE REMIX",
  "INTERLUDE",
];

interface FaixaPendente {
  musicaRowIndex: number;
  titulo: string;
  album: string;
  tipoSingleAtual: string;
}

interface LancarFaixaAlbumModalProps {
  associatedArtists: string[];
  defaultArtist: string;
  nomeJogador: string;
  jogadorId: string;
  onClose: () => void;
}

// Botão próprio em Gestão pra centralizar o caminho de "lançar uma faixa de
// álbum que ficou pendente" — antes só dava pra fazer isso abrindo Editar >
// Álbuns > achando o álbum certo > rolando até a faixa. Junta os 3 passos
// (escolher a faixa pendente, entre TODOS os álbuns do artista de uma vez;
// virar tópico; escolher o tipo de lançamento) numa tela só, reaproveitando
// o mesmo publicarFaixaPendenteController que já existia.
export function LancarFaixaAlbumModal({
  associatedArtists,
  defaultArtist,
  nomeJogador,
  jogadorId,
  onClose,
}: LancarFaixaAlbumModalProps) {
  const [artista, setArtista] = useState(defaultArtist || associatedArtists[0] || "");
  const [faixas, setFaixas] = useState<FaixaPendente[] | null>(null);
  const [busca, setBusca] = useState("");
  const [selecionada, setSelecionada] = useState<FaixaPendente | null>(null);
  const [tipoSingle, setTipoSingle] = useState("LEAD SINGLE");
  const [publicando, setPublicando] = useState(false);

  useEffect(() => {
    if (!artista) return;
    setFaixas(null);
    setSelecionada(null);
    fetch(`/api/gestao/faixas-pendentes?artista=${encodeURIComponent(artista)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setFaixas(data?.success ? data.data : []))
      .catch(() => setFaixas([]));
  }, [artista]);

  const faixasFiltradas = useMemo(() => {
    if (!faixas) return [];
    const q = busca.trim().toLowerCase();
    if (!q) return faixas;
    return faixas.filter(
      (f) => f.titulo.toLowerCase().includes(q) || f.album.toLowerCase().includes(q),
    );
  }, [faixas, busca]);

  async function handlePublicar() {
    if (!selecionada) return;
    setPublicando(true);
    try {
      const res = await fetch("/api/gestao/faixa/publicar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          musicaRowIndex: selecionada.musicaRowIndex,
          nomeJogador,
          jogadorId,
          tipoSingle,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "Erro ao lançar a faixa.");
      haptic.success();
      toast.success("Faixa lançada!", {
        description: `"${selecionada.titulo}" agora tem tópico próprio nos charts.`,
      });
      onClose();
    } catch (err: any) {
      toast.error(err.message || "Não foi possível lançar essa faixa.");
    } finally {
      setPublicando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[200] bg-neutral-950 flex flex-col overflow-hidden text-white">
      <div className="flex items-center justify-between px-4 pt-[calc(env(safe-area-inset-top)+16px)] pb-3 border-b border-white/10">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.14em] text-emerald-400">Gestão</p>
          <h2 className="text-lg font-black italic uppercase tracking-tight">Lançar Faixa de Álbum</h2>
        </div>
        <button
          onClick={onClose}
          className="size-9 shrink-0 rounded-full bg-white/10 grid place-items-center hover:bg-white/20"
          aria-label="Fechar"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {associatedArtists.length > 1 && (
          <div className="space-y-1.5">
            <label className="text-xs font-bold uppercase tracking-wider text-neutral-400">Artista</label>
            <select
              value={artista}
              onChange={(e) => setArtista(e.target.value)}
              className="w-full px-4 py-3 bg-neutral-900 border border-white/10 rounded-2xl text-sm text-white focus:outline-none focus:border-emerald-500"
            >
              {associatedArtists.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </div>
        )}

        {!selecionada ? (
          <>
            <div className="relative">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-neutral-500" />
              <input
                type="text"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar faixa ou álbum..."
                className="w-full pl-10 pr-4 py-3 bg-neutral-900 border border-white/10 rounded-2xl text-sm text-white placeholder-neutral-500 focus:outline-none focus:border-emerald-500"
              />
            </div>

            {faixas === null ? (
              <div className="flex justify-center py-16 opacity-50">
                <Loader2 className="size-6 animate-spin" />
              </div>
            ) : faixasFiltradas.length === 0 ? (
              <div className="rounded-3xl bg-white/[0.03] border border-dashed border-white/10 p-10 text-center">
                <Disc className="size-8 mx-auto mb-3 text-neutral-600" />
                <p className="text-sm text-neutral-400">
                  {faixas.length === 0
                    ? "Nenhuma faixa de álbum pendente pra esse artista."
                    : "Nada encontrado com esse termo."}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {faixasFiltradas.map((f) => (
                  <button
                    key={f.musicaRowIndex}
                    onClick={() => {
                      haptic.selection();
                      setSelecionada(f);
                      setTipoSingle(f.tipoSingleAtual || "LEAD SINGLE");
                    }}
                    className="w-full text-left flex items-center justify-between gap-3 p-3.5 rounded-2xl bg-neutral-900 border border-white/10 hover:border-emerald-500/40 transition"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-bold truncate">{f.titulo}</p>
                      <p className="text-[11px] text-neutral-500 truncate">{f.album}</p>
                    </div>
                    <span className="shrink-0 px-2 py-1 rounded-full bg-yellow-500/15 text-yellow-400 text-[9.5px] font-black uppercase tracking-wide">
                      Pendente
                    </span>
                  </button>
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="space-y-5">
            <button
              onClick={() => setSelecionada(null)}
              className="text-xs font-bold text-neutral-400 hover:text-white"
            >
              ← Escolher outra faixa
            </button>

            <div className="rounded-2xl bg-neutral-900 border border-white/10 p-4">
              <p className="text-[10px] font-black uppercase tracking-wide text-emerald-400 mb-1">
                Faixa selecionada
              </p>
              <p className="text-base font-bold">{selecionada.titulo}</p>
              <p className="text-xs text-neutral-500">{selecionada.album}</p>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wider text-neutral-400">
                Lançar como
              </label>
              <select
                value={tipoSingle}
                onChange={(e) => setTipoSingle(e.target.value)}
                className="w-full px-4 py-3 bg-neutral-900 border border-white/10 rounded-2xl text-sm text-white focus:outline-none focus:border-emerald-500"
              >
                {TIPOS_SINGLE_FAIXA.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-neutral-500">
                Vira tópico de verdade nos charts, com esse tipo de lançamento.
              </p>
            </div>

            <button
              onClick={handlePublicar}
              disabled={publicando}
              className="w-full h-12 rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-black font-black uppercase text-sm tracking-wide disabled:opacity-50 flex items-center justify-center gap-2 transition"
            >
              {publicando ? <Loader2 className="size-4 animate-spin" /> : <Rocket className="size-4" />}
              Lançar faixa
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

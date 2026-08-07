import { createFileRoute, Link } from "@tanstack/react-router";
import { BackButton } from "@/components/BackButton";
import { useEffect, useState } from "react";
import { ChevronLeft, Dice5, Loader2, Info, Trophy, Music } from "lucide-react";
import { api, fmtEC, driveImg } from "@/lib/api";
import { useTelegramUser } from "@/lib/telegram";
import { notify } from "@/lib/notify";
import { Field, Input } from "./acoes.tour";

export const Route = createFileRoute("/bet")({
  component: BetPage,
});

interface BetMusic {
  musica: string;
  artista: string;
  capa: string;
  posicao?: number;
}

function BetPage() {
  const { user, ready } = useTelegramUser();
  const [artists, setArtists] = useState<any[]>([]);
  const [betData, setBetData] = useState<{
    semana: string;
    musicas: BetMusic[];
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Form
  const [selectedArtist, setSelectedArtist] = useState("");
  const [valor, setValor] = useState("");
  const [bets, setBets] = useState<Record<string, string>>({}); // { musica: posicao }
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (!ready || !user) return;
    setLoading(true);
    Promise.all([api.meusArtistas(user.id), api.getMusicasBet()]).then(([a, b]) => {
      setArtists(a);
      if (a.length > 0) setSelectedArtist(a[0].nome);
      
      if (b && Array.isArray(b.musicas)) {
        // Normaliza as músicas vindas do Sheets (especialmente da aba EDIÇÃO CHARTS)
        const musicasNormalizadas = b.musicas.map((m: any) => {
          if (typeof m === "string") return { musica: m, artista: "Vários", capa: "" };
          return {
            musica: m.musica || m.Musica || m.Música || m.B || m[1] || "",
            artista: m.artista || m.Artista || m.A || m[0] || "Empire Artist",
            capa: m.capa || m.Capa || m.foto || m.capa_url || ""
          };
        }).filter(m => m.musica);
        
        setBetData({ ...b, musicas: musicasNormalizadas as any });
      } else if (b) {
        setBetData(b as any);
      }
      
      setLoading(false);
    });
  }, [ready, user]);

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    const r = await api.searchSongs(searchQuery);
    setSearchResults(r);
    setSearching(false);
  };

  const addSongToBet = (m: any) => {
    // Adiciona ao betData local se não estiver lá
    setBetData(prev => {
      if (!prev) return { semana: "Atual", musicas: [m] };
      if (prev.musicas.some(x => x.musica === m.musica)) return prev;
      return { ...prev, musicas: [m, ...prev.musicas] };
    });
    setSearchQuery("");
    setSearchResults([]);
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedArtist || !valor || !betData || (Object.keys(bets).length === 0)) {
      notify({
        erro: "Preencha o artista, valor da aposta e pelo menos uma previsão.",
      });
      return;
    }
    setSubmitting(true);
    const r = await api.bet({
      nome: selectedArtist,
      valor: parseFloat(valor),
      semana: betData.semana,
      previsoes: JSON.stringify(bets),
    });
    notify(r, { successFallback: "Aposta registrada no Empire Bet!" });
    if (!r.erro) setBets({});
    setSubmitting(false);
  }

  const updBet = (musica: string, pos: string) => {
    setBets((prev) => {
      const next = { ...prev };
      if (pos === "") delete next[musica];
      else next[musica] = pos;
      return next;
    });
  };

  if (loading) {
    return (
      <main className="flex-1 mx-auto w-full max-w-2xl px-4 pt-40 text-center">
        <Loader2 className="size-10 animate-spin mx-auto text-primary" />
      </main>
    );
  }

  return (
    <main className="flex-1 mx-auto w-full max-w-2xl px-4 pt-6 pb-20">
      <BackButton />

      <header className="mb-8">
        <div className="size-12 rounded-xl bg-purple-500/15 text-purple-500 grid place-items-center mb-4">
          <Dice5 className="size-6" />
        </div>
        <h1 className="text-xl font-black italic tracking-tighter uppercase">Empire Bet</h1>
        <p className="text-sm text-balance text-muted-foreground mt-2 leading-relaxed">
          Aposte no desempenho das músicas nas paradas. Lucro garantido para os visionários.
        </p>
      </header>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Apostar como">
            <select
              value={selectedArtist}
              onChange={(e) => setSelectedArtist(e.target.value)}
              className="w-full bg-card border border-white/5 rounded-2xl px-4 py-3.5 text-sm font-bold focus:ring-2 focus:ring-primary/20 outline-none transition-all"
            >
              {artists.map((a) => (
                <option key={a.nome} value={a.nome}>
                  {a.nome} ({fmtEC(a.saldo)})
                </option>
              ))}
            </select>
          </Field>
          <Field label="Montante da Aposta">
            <Input
              type="number"
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              placeholder="Mínimo EC 10.000"
              className="rounded-2xl"
              required
            />
          </Field>
        </div>

        {/* Busca de Músicas */}
        <div className="p-4 rounded-3xl bg-white/[0.03] border border-white/5">
          <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-3 px-1">Buscar múscia no sistema para apostar</p>
          <div className="flex gap-2">
            <input 
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={e => e.key === "Enter" && (e.preventDefault(), handleSearch())}
              placeholder="Nome da música ou artista..."
              className="flex-1 bg-background border border-white/10 rounded-xl px-4 py-3 text-xs outline-none focus:border-primary"
            />
            <button 
              type="button"
              onClick={handleSearch}
              disabled={searching}
              className="bg-primary px-4 rounded-xl text-[10px] font-black uppercase tracking-widest disabled:opacity-50"
            >
              {searching ? "..." : "Buscar"}
            </button>
          </div>
          
          {searchResults.length > 0 && (
            <div className="mt-4 space-y-1 max-h-40 overflow-y-auto pr-1">
              {searchResults.map((m, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => addSongToBet(m)}
                  className="w-full flex items-center gap-3 p-2 rounded-xl hover:bg-white/5 text-left transition-colors group"
                >
                  <img src={driveImg(m.capa, 40)} className="size-8 rounded object-cover border border-white/10"  loading="lazy" decoding="async"/>
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-black leading-none mb-1">{m.musica}</p>
                    <p className="text-[11px] text-muted-foreground font-bold">{m.artista}</p>
                  </div>
                  <div className="text-primary text-[11px] font-black uppercase opacity-0 group-hover:opacity-100">+ Adicionar</div>
                </button>
              ))}
            </div>
          )}
        </div>

        <section className="space-y-4">
          <div className="flex items-center justify-between px-1">
            <h2 className="text-[10px] uppercase tracking-[0.2em] font-black text-muted-foreground">
              Músicas Disponíveis: {betData?.semana}
            </h2>
            <div className="bg-primary/10 text-primary px-3 py-1 rounded-full text-[11px] font-black uppercase border border-primary/20">
               {betData?.musicas.length || 0} Opções
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2">
            {!betData || betData.musicas.length === 0 ? (
              <div className="py-12 text-center bg-white/[0.02] rounded-3xl border border-dashed border-white/10">
                <Music className="size-8 text-muted-foreground/30 mx-auto mb-2" />
                <p className="text-xs text-muted-foreground">Aguardando lista de músicas da semana...</p>
              </div>
            ) : (
              betData.musicas.map((m) => (
                <div
                  key={m.musica}
                  className="flex items-center gap-4 p-3 rounded-2xl bg-card border border-white/5 group transition-all focus-within:border-primary/50 focus-within:bg-white/[0.04]"
                >
                  {m.capa && (
                    <img
                      src={driveImg(m.capa, 100)}
                      alt=""
                      className="size-12 rounded-xl object-cover bg-secondary p-0.5 border border-white/10"
                     loading="lazy" decoding="async"/>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-black truncate">{m.musica}</p>
                    <p className="text-[10px] text-muted-foreground font-bold truncate">{m.artista}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <p className="text-[11px] uppercase font-black text-muted-foreground mb-1">Posição</p>
                      <input
                        type="number"
                        min="1"
                        max="100"
                        placeholder="—"
                        value={bets[m.musica] || ""}
                        onChange={(e) => updBet(m.musica, e.target.value)}
                        className="w-14 bg-background border border-white/10 rounded-lg px-2 py-2 text-center text-xs font-black focus:border-primary focus:outline-none transition-colors"
                      />
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        <div className="p-5 rounded-3xl bg-purple-500/5 border border-purple-500/10 space-y-3 font-medium text-xs text-muted-foreground">
          <p className="flex items-start gap-3">
            <Trophy className="size-4 text-purple-500 shrink-0" />
            <span>O Empire Bet analisa o rank da próxima semana. Acertos exatos garantem retornos massivos de capital.</span>
          </p>
          <p className="flex items-start gap-3">
            <Info className="size-4 text-purple-500 shrink-0" />
            <span>Você pode apostar em até 10 músicas por vez.</span>
          </p>
        </div>

        <button
          type="submit"
          disabled={submitting || !valor || Object.keys(bets).length === 0}
          className="w-full py-5 rounded-3xl bg-purple-600 text-white font-black uppercase text-xs tracking-widest shadow-xl shadow-purple-600/30 disabled:opacity-30 disabled:grayscale transition-all hover:scale-[1.01] active:scale-[0.99] flex items-center justify-center gap-3"
        >
          {submitting ? <Loader2 className="size-5 animate-spin" /> : <Dice5 className="size-5" />}
          Finalizar Apostas Imperiais
        </button>
      </form>
    </main>
  );
}

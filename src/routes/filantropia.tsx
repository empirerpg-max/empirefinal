import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ChevronLeft, HandHeart, Loader2, Heart, Sparkles, Star, ChevronRight } from "lucide-react";
import { api, fmtEC, driveImg, type Artist } from "@/lib/api";
import { useTelegramUser } from "@/lib/telegram";
import { notify } from "@/lib/notify";
import { Field, Input } from "./acoes.tour";
import { motion } from "motion/react";

export const Route = createFileRoute("/filantropia")({
  component: FilantropiaPage,
});

const CAUSAS = [
  { id: "nature", label: "Preservação da Amazônia", icon: "🌳" },
  { id: "hunger", label: "Combate à Fome", icon: "🍛" },
  { id: "children", label: "Educação Infantil", icon: "📚" },
  { id: "health", label: "Saúde Pública", icon: "🏥" },
  { id: "arts", label: "Fomento às Artes", icon: "🎨" },
];

function FilantropiaPage() {
  const { user, ready } = useTelegramUser();
  const [artists, setArtists] = useState<Artist[]>([]);
  const [radar, setRadar] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [showForm, setShowForm] = useState(false);

  // Form states
  const [selectedArtist, setSelectedArtist] = useState("");
  const [causa, setCausa] = useState(CAUSAS[0].label);
  const [valor, setValor] = useState("100000");

  useEffect(() => {
    if (!ready || !user) return;
    
    // Carregar feed filtrado por filantropia
    api.radar().then(all => {
      setRadar(all.filter(i => 
        i.acao.toLowerCase().includes("filantropia") || 
        i.acao.toLowerCase().includes("doou") ||
        i.acao.toLowerCase().includes("causa")
      ));
    });

    api.meusArtistas(user.id).then((a) => {
      setArtists(a);
      if (a.length > 0) setSelectedArtist(a[0].nome);
      setLoading(false);
    });
  }, [ready, user]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const vNum = parseFloat(valor);
    if (!selectedArtist || !causa || vNum < 100000) {
      notify({ erro: "Valor mínimo: EC 100.000" });
      return;
    }
    setSubmitting(true);
    const r = await api.filantropia(selectedArtist, causa, valor);
    notify(r, { successFallback: "Doação realizada! O legado do seu artista brilhou." });
    setSubmitting(false);
    if (r.ok) {
       setShowForm(false);
       api.radar().then(all => {
          setRadar(all.filter(i => 
            i.acao.toLowerCase().includes("filantropia") || 
            i.acao.toLowerCase().includes("doou")
          ));
       });
    }
  }

  return (
    <main className="flex-1 mx-auto w-full max-w-2xl px-6 pt-8 pb-32">
      <header className="mb-10">
        <div className="flex items-center gap-4 mb-6">
           <div className="size-14 rounded-2xl bg-red-500/10 text-red-500 grid place-items-center shadow-xl shadow-red-500/10">
              <HandHeart className="size-8" />
           </div>
           <div>
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground italic">Empire Industries</p>
              <h1 className="text-4xl font-black italic uppercase tracking-tighter leading-none">Philanthropy</h1>
           </div>
        </div>
        <p className="text-sm text-muted-foreground font-medium leading-relaxed">
          Monitorando o impacto social e as contribuições humanitárias da elite da música.
        </p>
      </header>

      {showForm ? (
        <div className="space-y-6">
           <div className="flex items-center justify-between px-1">
              <h2 className="text-lg font-black italic uppercase tracking-tight">Nova Ação Social</h2>
              <button 
                onClick={() => setShowForm(false)}
                className="text-[10px] font-black uppercase text-muted-foreground hover:text-foreground"
              >
                Cancelar
              </button>
           </div>
           
           <form onSubmit={handleSubmit} className="space-y-6">
              <div className="p-6 rounded-[2.5rem] bg-card border border-white/5 space-y-5">
                <div className="space-y-1.5">
                   <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground px-1">Doador</label>
                   <select
                     value={selectedArtist}
                     onChange={(e) => setSelectedArtist(e.target.value)}
                     className="w-full bg-background border border-white/10 rounded-2xl px-4 py-4 text-sm focus:border-red-500 transition-colors"
                     disabled={loading}
                   >
                     {artists.map((a) => (
                       <option key={a.nome} value={a.nome}>
                         {a.nome} ({fmtEC(a.saldo)})
                       </option>
                     ))}
                   </select>
                </div>

                <div className="space-y-1.5">
                   <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground px-1">Causa Humanitária</label>
                   <select
                     value={causa}
                     onChange={(e) => setCausa(e.target.value)}
                     className="w-full bg-background border border-white/10 rounded-2xl px-4 py-4 text-sm focus:border-red-500 transition-colors"
                   >
                     {CAUSAS.map((c) => (
                       <option key={c.id} value={c.label}>
                         {c.icon} {c.label}
                       </option>
                     ))}
                   </select>
                </div>

                <div className="space-y-1.5">
                   <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground px-1">Investimento (Mín EC 100k)</label>
                   <input
                     type="number"
                     value={valor}
                     onChange={(e) => setValor(e.target.value)}
                     className="w-full bg-background border border-white/10 rounded-2xl px-4 py-4 text-sm focus:border-red-500 transition-colors"
                     required
                   />
                </div>
              </div>

              <button
                type="submit"
                disabled={submitting || !selectedArtist || parseFloat(valor) < 100000}
                className="w-full py-5 rounded-[2rem] bg-red-500 text-white font-black uppercase tracking-widest shadow-2xl shadow-red-500/30 disabled:opacity-50 flex items-center justify-center gap-3 transition-all active:scale-95"
              >
                {submitting ? <Loader2 className="size-5 animate-spin" /> : <Heart className="size-5" />}
                Efetivar Doação
              </button>
           </form>
        </div>
      ) : (
        <div className="space-y-8">
           <button 
             onClick={() => setShowForm(true)}
             className="w-full p-6 rounded-[2.5rem] bg-card border border-white/5 flex items-center justify-between group hover:border-red-500/30 transition-all active:scale-[0.98]"
           >
              <div className="flex items-center gap-4">
                 <div className="size-12 rounded-2xl bg-red-500/10 text-red-500 grid place-items-center group-hover:bg-red-500 group-hover:text-white transition-colors">
                    <HandHeart className="size-6" />
                 </div>
                 <div className="text-left">
                    <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Legacy Builder</span>
                    <h3 className="font-black italic uppercase tracking-tighter text-lg leading-none">Iniciar Ação Social</h3>
                 </div>
              </div>
              <ChevronRight className="size-5 text-muted-foreground group-hover:text-red-500 transition-colors" />
           </button>

           <section>
              <div className="flex items-end justify-between mb-6 px-1">
                 <h2 className="text-lg font-black italic uppercase tracking-tight">Atividade Recente</h2>
                 <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/40">{radar.length} Ações</span>
              </div>

              {radar.length === 0 ? (
                <div className="p-12 text-center rounded-[2.5rem] bg-white/[0.02] border border-dashed border-white/10">
                   <p className="text-xs text-muted-foreground italic">Nenhuma ação humanitária registrada recentemente.</p>
                </div>
              ) : (
                <div className="space-y-3">
                   {radar.map((i, idx) => (
                      <div key={idx} className="flex items-center gap-4 p-4 rounded-[2rem] bg-card border border-white/5">
                         <div className="size-12 rounded-2xl overflow-hidden shrink-0 border border-white/5 bg-secondary">
                            <img src={driveImg(i.foto, 100)} alt="" className="w-full h-full object-cover grayscale"  loading="lazy" decoding="async"/>
                         </div>
                         <div className="flex-1 min-w-0">
                            <p className="text-[10px] font-black uppercase tracking-widest text-red-500 mb-0.5">Filantropia</p>
                            <p className="text-sm font-black italic uppercase truncate">{i.nome}</p>
                            <p className="text-[11px] text-muted-foreground truncate italic">{i.acao}</p>
                         </div>
                         <div className="text-[11px] font-black text-muted-foreground/30">{i.timestamp.split(" ")[1]}</div>
                      </div>
                   ))}
                </div>
              )}
           </section>
        </div>
      )}
    </main>
  );
}

import { createFileRoute, Link } from "@tanstack/react-router";
import { BackButton } from "@/components/BackButton";
import { useEffect, useMemo, useState } from "react";
import {
  ChevronLeft,
  ShoppingBag,
  Loader2,
  X,
  Music,
  Building2,
  Briefcase,
  Sparkles,
  Plane,
  PlusCircle,
  Gem,
  Megaphone,
} from "lucide-react";
import { useTelegramUser } from "@/lib/telegram";
import { api, fmtEC, type MarketItem, type MuralItem, type Artist, driveImg } from "@/lib/api";
import { notify } from "@/lib/notify";

export const Route = createFileRoute("/market")({
  component: MarketPage,
});

const CAT_META: Record<string, { label: string; icon: React.ReactNode; color: string; bgColor: string }> = {
  MARKET: {
    label: "Boosts",
    icon: <Sparkles className="size-4" />,
    color: "text-blue-500",
    bgColor: "bg-blue-500/10",
  },
  IMOVEIS: {
    label: "Imóveis",
    icon: <Building2 className="size-4" />,
    color: "text-emerald-500",
    bgColor: "bg-emerald-500/10",
  },
  CARREIRA: {
    label: "Carreira",
    icon: <Briefcase className="size-4" />,
    color: "text-amber-500",
    bgColor: "bg-amber-500/10",
  },
  TOURS: {
    label: "Tours",
    icon: <Plane className="size-4" />,
    color: "text-primary",
    bgColor: "bg-primary/10",
  },
  MURAL: {
    label: "Música",
    icon: <Music className="size-4" />,
    color: "text-purple-500",
    bgColor: "bg-purple-500/10",
  },
  SISTEMA: {
    label: "Especial",
    icon: <Gem className="size-4" />,
    color: "text-rose-500",
    bgColor: "bg-rose-500/10",
  }
};



function MarketPage() {
  const { user, ready } = useTelegramUser();
  const [tab, setTab] = useState<"catalogo" | "mural">("catalogo");
  const [cat, setCat] = useState<string>("ALL");
  const [items, setItems] = useState<MarketItem[] | null>(null);
  const [mural, setMural] = useState<MuralItem[] | null>(null);
  const [artists, setArtists] = useState<Artist[]>([]);
  const [catOrder, setCatOrder] = useState<string[]>([]);
  const [buying, setBuying] = useState<
    { kind: "market"; item: MarketItem } | { kind: "mural"; item: MuralItem } | null
  >(null);
  const [isSelling, setIsSelling] = useState(false);

  useEffect(() => {
    api.listarMarket().then(setItems);
    api.listarMural().then(setMural);
    api.listarCategoriasMarket().then(setCatOrder).catch(() => setCatOrder([]));
  }, []);

  useEffect(() => {
    if (!ready || !user) return;
    api.meusArtistas(user.id).then(setArtists);
  }, [ready, user]);

  // Categorias ordenadas pelo CONFIG_SISTEMA. Categorias presentes nos itens
  // mas não listadas no config aparecem ao final, em ordem alfabética.
  const cats = useMemo(() => {
    if (!items) return [];
    const presentes = new Set(items.map((i) => i.categoria).filter(Boolean));
    const oficiais = catOrder.filter((c) => presentes.has(c));
    const extras = Array.from(presentes)
      .filter((c) => !catOrder.includes(c))
      .sort();
    return [...oficiais, ...extras];
  }, [items, catOrder]);

  // Garante que a categoria selecionada ainda existe após o reload
  useEffect(() => {
    if (cat !== "ALL" && cats.length && !cats.includes(cat)) setCat("ALL");
  }, [cats, cat]);

  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    (items || []).forEach((i) => {
      m[i.categoria] = (m[i.categoria] || 0) + 1;
    });
    return m;
  }, [items]);

  const filtered = useMemo(() => {
    if (!items) return [];
    return items.filter((i) => cat === "ALL" || i.categoria === cat);
  }, [items, cat]);

  return (
    <main className="flex-1 mx-auto w-full max-w-2xl px-4 pt-6 pb-24">
      <header className="mb-8">
        <BackButton />
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="size-12 rounded-2xl bg-primary/15 text-primary grid place-items-center">
              <ShoppingBag className="size-6" />
            </div>
            <div>
              <p className="text-[10px] uppercase font-black tracking-widest text-primary">Império Market</p>
              <h1 className="text-2xl font-black italic uppercase tracking-tighter">Marketplace</h1>
            </div>
          </div>
          {tab === "mural" && (
             <button 
                onClick={() => setIsSelling(true)}
                className="size-12 rounded-2xl bg-white/5 border border-white/10 grid place-items-center active:scale-95 transition-all text-primary"
             >
                <PlusCircle className="size-6" />
             </button>
          )}
        </div>
      </header>

      {/* Tabs Estilo App */}
      <div className="flex p-1.5 bg-card rounded-3xl border border-white/5 mb-6">
        <button
          onClick={() => setTab("catalogo")}
          className={`flex-1 py-3 rounded-[1.25rem] text-[10px] uppercase font-black tracking-widest transition-all ${
            tab === "catalogo" ? "bg-primary text-primary-foreground shadow-lg shadow-primary/20" : "text-muted-foreground"
          }`}
        >
          Catálogo Imperial
        </button>
        <button
          onClick={() => setTab("mural")}
          className={`flex-1 py-3 rounded-[1.25rem] text-[10px] uppercase font-black tracking-widest transition-all ${
            tab === "mural" ? "bg-primary text-primary-foreground shadow-lg shadow-primary/20" : "text-muted-foreground"
          }`}
        >
          Mural de Composições
        </button>
      </div>

      {tab === "catalogo" && (
        <>
          <div className="flex gap-3 overflow-x-auto scrollbar-hide -mx-4 px-4 mb-8">
             <button
               onClick={() => setCat("ALL")}
               className={`relative shrink-0 h-24 w-20 rounded-[2rem] flex flex-col items-center justify-center gap-2 border transition-all ${
                 cat === "ALL" ? "bg-primary border-primary text-primary-foreground shadow-xl shadow-primary/20" : "bg-card border-white/5 text-muted-foreground"
               }`}
             >
               <div className={`size-10 rounded-full grid place-items-center ${cat === "ALL" ? "bg-white/20" : "bg-white/5"}`}>
                 <ShoppingBag className="size-5" />
               </div>
               <span className="text-[10px] font-black uppercase tracking-tighter">Tudo</span>
               {items && items.length > 0 && (
                 <span className={`absolute -top-1 -right-1 min-w-[20px] h-5 px-1.5 rounded-full text-[10px] font-black grid place-items-center ${cat === "ALL" ? "bg-white text-primary" : "bg-primary text-primary-foreground"}`}>
                   {items.length}
                 </span>
               )}
             </button>
             {cats.map(c => (
                <button
                  key={c}
                  onClick={() => setCat(c)}
                  className={`relative shrink-0 h-24 w-20 rounded-[2rem] flex flex-col items-center justify-center gap-2 border transition-all ${
                    cat === c ? "bg-primary border-primary text-primary-foreground shadow-xl shadow-primary/20" : "bg-card border-white/5 text-muted-foreground"
                  }`}
                >
                  <div className={`size-10 rounded-full grid place-items-center ${cat === c ? "bg-white/20" : CAT_META[c]?.bgColor || "bg-white/5"}`}>
                    {CAT_META[c]?.icon || <Gem className="size-5" />}
                  </div>
                  <span className="text-[10px] font-black uppercase tracking-tighter truncate w-16 text-center">
                    {CAT_META[c]?.label || c}
                  </span>
                  {counts[c] > 0 && (
                    <span className={`absolute -top-1 -right-1 min-w-[20px] h-5 px-1.5 rounded-full text-[10px] font-black grid place-items-center ${cat === c ? "bg-white text-primary" : "bg-primary text-primary-foreground"}`}>
                      {counts[c]}
                    </span>
                  )}
                </button>
             ))}
          </div>

          {items === null ? (
            <div className="grid grid-cols-1 gap-3">
               {[1,2,3,4].map(i => <div key={i} className="h-28 rounded-3xl bg-card animate-pulse" />)}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3">
              {filtered.map((it, i) => (
                <button
                  key={i}
                  onClick={() => setBuying({ kind: "market", item: it })}
                  className="flex items-center gap-4 p-4 rounded-3xl bg-card border border-white/5 transition-all hover:bg-white/[0.04] active:scale-[0.98] group text-left"
                >
                  <div className={`size-16 rounded-2xl shrink-0 grid place-items-center ${CAT_META[it.categoria]?.bgColor || "bg-secondary"}`}>
                     <div className={CAT_META[it.categoria]?.color || "text-muted-foreground"}>
                        {CAT_META[it.categoria]?.icon || <ShoppingBag className="size-6" />}
                     </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] uppercase font-black tracking-widest text-muted-foreground mb-0.5">{it.categoria}</p>
                    <h3 className="font-black text-base truncate tracking-tight text-white mb-0.5">{it.item}</h3>
                    <p className="text-[10px] text-muted-foreground font-medium truncate italic">{it.efeito || "Item disponível para aquisição no império."}</p>
                  </div>
                  <div className="text-right">
                     <p className="text-xs font-black text-primary">{fmtEC(it.preco)}</p>
                     <span className="text-[11px] font-black uppercase tracking-tighter text-muted-foreground/30">Custo Total</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {tab === "mural" && (
        <div className="space-y-4">
          <div className="p-5 rounded-3xl bg-primary/5 border border-primary/10 flex items-center gap-4">
             <Megaphone className="size-6 text-primary shrink-0" />
             <p className="text-xs font-medium text-muted-foreground leading-relaxed">
               Composições exclusivas prontas para o seu próximo hit. Compre o direito total e lance seu novo single.
             </p>
          </div>

          {mural === null ? (
             <div className="grid grid-cols-1 gap-3">
                {[1,2,3].map(i => <div key={i} className="h-32 rounded-3xl bg-card animate-pulse" />)}
             </div>
          ) : mural.length === 0 ? (
             <EmptyCard>O mural está limpo hoje. Seja o primeiro a vender sua obra.</EmptyCard>
          ) : (
             <div className="grid grid-cols-1 gap-3">
                {mural.map((m) => (
                   <button
                     key={m.id}
                     onClick={() => setBuying({ kind: "mural", item: m })}
                     className="w-full relative overflow-hidden p-5 rounded-[2.5rem] bg-card border border-white/5 transition-all hover:bg-white/[0.04] text-left group"
                   >
                     <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-20 transition-opacity">
                        <Music className="size-20" />
                     </div>
                     <div className="relative z-10">
                        <div className="flex justify-between items-start mb-3">
                           <div>
                              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-primary mb-1">Composição Premium</p>
                              <h3 className="text-xl font-black italic uppercase tracking-tighter">{m.titulo}</h3>
                           </div>
                           <p className="text-sm font-black bg-white/5 px-3 py-1.5 rounded-xl border border-white/5">{fmtEC(m.preco)}</p>
                        </div>
                        <p className="text-xs text-muted-foreground font-medium mb-4 italic">"{m.teaser || "Uma obra prima aguardando sua voz..."}"</p>
                        <div className="flex items-center gap-2 pt-4 border-t border-white/5">
                           <div className="size-6 rounded-full bg-secondary overflow-hidden">
                              <img src="https://images.unsplash.com/photo-1514525253361-bee8718a300c?w=100&h=100&fit=crop" className="w-full h-full object-cover"  loading="lazy" decoding="async"/>
                           </div>
                           <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Vendedor: {m.vendedor}</span>
                        </div>
                     </div>
                   </button>
                ))}
             </div>
          )}
        </div>
      )}

      {buying && (
        <BuyModal
          buying={buying}
          artists={artists}
          onClose={() => setBuying(null)}
          onSuccess={() => {
            setBuying(null);
            api.listarMural().then(setMural);
          }}
        />
      )}

      {isSelling && (
        <SellModal 
          artists={artists} 
          onClose={() => setIsSelling(false)} 
          onSuccess={() => {
            setIsSelling(false);
            api.listarMural().then(setMural);
          }}
        />
      )}
    </main>
  );
}

// --- Modais ---
function BuyModal({ buying, artists, onClose, onSuccess }: any) {
  const [nome, setNome] = useState(artists[0]?.nome || "");
  const [submitting, setSubmitting] = useState(false);
  const it = buying.item;
  const preco = it.preco;
  const artist = artists.find((a: any) => a.nome === nome);
  const pode = artist ? artist.saldo >= preco : false;

  const go = async () => {
    setSubmitting(true);
    const r = buying.kind === "market" 
      ? await api.comprarMarket({ nome, categoria: it.categoria, item: it.item })
      : await api.comprarMural({ nome, id: it.id });
    notify(r, { successFallback: "Transação Imperial confirmada!" });
    setSubmitting(false);
    if (!r.erro) onSuccess();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-md p-4" onClick={onClose}>
      <div className="w-full max-w-sm bg-card border border-white/10 rounded-[2.5rem] p-6 shadow-2xl animate-in fade-in slide-in-from-bottom-8 duration-500" onClick={e => e.stopPropagation()}>
         <div className="flex justify-between items-center mb-6">
            <h3 className="text-xl font-black italic uppercase tracking-tighter">Confirmar Compra</h3>
            <button onClick={onClose} className="size-8 rounded-full bg-white/5 grid place-items-center opacity-50 hover:opacity-100">
               <X className="size-4" />
            </button>
         </div>

         <div className="p-5 rounded-3xl bg-secondary/50 border border-white/5 mb-6">
            <p className="text-[10px] font-black uppercase text-muted-foreground tracking-widest mb-1">
               {buying.kind === "market" ? it.categoria : "Mural de Composições"}
            </p>
            <h4 className="text-lg font-black tracking-tight mb-2">{buying.kind === "market" ? it.item : it.titulo}</h4>
            <p className="text-2xl font-black text-primary">{fmtEC(preco)}</p>
         </div>

         <div className="space-y-4">
            <div>
               <label className="text-[10px] font-black uppercase text-muted-foreground tracking-widest mb-2 block px-1">Comprar com</label>
               <select 
                 value={nome}
                 onChange={e => setNome(e.target.value)}
                 className="w-full bg-background border border-white/10 rounded-2xl px-4 py-3.5 text-xs font-black outline-none focus:border-primary transition-all"
               >
                  {artists.map((a: any) => (
                    <option key={a.nome} value={a.nome}>{a.nome} ({fmtEC(a.saldo)})</option>
                  ))}
               </select>
            </div>

            {artist && !pode && (
               <p className="text-[10px] font-bold text-destructive px-1 uppercase tracking-tighter">Empire Coin insuficiente para esta transação.</p>
            )}

            <button
               onClick={go}
               disabled={submitting || !pode}
               className="w-full py-5 rounded-[2rem] bg-primary text-primary-foreground font-black uppercase text-xs tracking-widest shadow-xl shadow-primary/30 disabled:opacity-30 flex items-center justify-center gap-3 transition-all active:scale-95"
            >
               {submitting ? <Loader2 className="size-5 animate-spin" /> : "Confirmar e Pagar"}
            </button>
         </div>
      </div>
    </div>
  );
}

function SellModal({ artists, onClose, onSuccess }: any) {
  const [nome, setNome] = useState(artists[0]?.nome || "");
  const [titulo, setTitulo] = useState("");
  const [preco, setPreco] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const go = async (e: any) => {
    e.preventDefault();
    setSubmitting(true);
    const r = await api.venderComposicao({ nome, titulo, preco: parseFloat(preco) });
    notify(r, { successFallback: "Obra publicada no mural!" });
    setSubmitting(false);
    if (!r.erro) onSuccess();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-md p-4" onClick={onClose}>
      <form className="w-full max-w-sm bg-card border border-white/10 rounded-[2.5rem] p-6 shadow-2xl animate-in fade-in slide-in-from-bottom-8 duration-500" onClick={e => e.stopPropagation()} onSubmit={go}>
         <div className="flex justify-between items-center mb-6">
            <h3 className="text-xl font-black italic uppercase tracking-tighter">Vender Composição</h3>
            <button type="button" onClick={onClose} className="size-8 rounded-full bg-white/5 grid place-items-center opacity-50 hover:opacity-100">
               <X className="size-4" />
            </button>
         </div>

         <div className="space-y-4">
            <div>
               <label className="text-[10px] font-black uppercase text-muted-foreground tracking-widest mb-2 block px-1">Artista Vendedor</label>
               <select 
                 value={nome}
                 onChange={e => setNome(e.target.value)}
                 className="w-full bg-background border border-white/10 rounded-2xl px-4 py-3.5 text-xs font-black outline-none"
               >
                  {artists.map((a: any) => (
                    <option key={a.nome} value={a.nome}>{a.nome}</option>
                  ))}
               </select>
            </div>
            <div>
               <label className="text-[10px] font-black uppercase text-muted-foreground tracking-widest mb-2 block px-1">Título da Obra</label>
               <input 
                 type="text"
                 required
                 value={titulo}
                 onChange={e => setTitulo(e.target.value)}
                 placeholder="Ex: Moonlight Shadow"
                 className="w-full bg-background border border-white/10 rounded-2xl px-4 py-3.5 text-xs font-black outline-none"
               />
            </div>
            <div>
               <label className="text-[10px] font-black uppercase text-muted-foreground tracking-widest mb-2 block px-1">Preço Sugerido (EC)</label>
               <input 
                 type="number"
                 required
                 value={preco}
                 onChange={e => setPreco(e.target.value)}
                 placeholder="Mínimo 50.000"
                 className="w-full bg-background border border-white/10 rounded-2xl px-4 py-3.5 text-xs font-black outline-none"
               />
            </div>

            <button
               type="submit"
               disabled={submitting || !titulo || !preco}
               className="w-full py-5 rounded-[2rem] bg-primary text-primary-foreground font-black uppercase text-xs tracking-widest shadow-xl shadow-primary/30 disabled:opacity-30 flex items-center justify-center gap-3 mt-4"
            >
               {submitting ? <Loader2 className="size-5 animate-spin" /> : "Publicar no Mural"}
            </button>
         </div>
      </form>
    </div>
  );
}

function EmptyCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-[2.5rem] bg-card/40 border border-dashed border-white/10 p-12 text-center text-xs text-muted-foreground italic">
      {children}
    </div>
  );
}

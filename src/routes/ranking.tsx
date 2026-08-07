import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Crown } from "lucide-react";
import { api, fmtMoney, driveImg, type Artist } from "@/lib/api";

export const Route = createFileRoute("/ranking")({ component: Ranking });

function Ranking() {
  const [data, setData] = useState<Artist[] | null>(null);
  const [tab, setTab] = useState<"fortuna" | "prestigio">("fortuna");

  useEffect(() => {
    if (tab === "fortuna") {
      api.ranking().then(setData);
    } else {
      api.charts().then(setData);
    }
  }, [tab]);

  const sorted = data || [];

  return (
    <main className="flex-1 mx-auto w-full max-w-2xl px-6 pt-8 pb-24">
      <header className="mb-8">
        <div className="flex items-center gap-4 mb-6">
           <div className="size-14 rounded-2xl bg-primary/10 text-primary grid place-items-center shadow-xl shadow-primary/10">
              <Crown className="size-8" />
           </div>
           <div>
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground italic">Empire Industries</p>
              <h1 className="text-2xl font-black italic uppercase tracking-tighter leading-none">Rankings</h1>
           </div>
        </div>

        <div className="flex p-1 bg-card rounded-[2rem] border border-white/5">
           <button 
             onClick={() => setTab("fortuna")}
             className={`flex-1 py-4 rounded-[1.8rem] text-[10px] font-black uppercase tracking-[0.1em] transition-all ${tab === "fortuna" ? "bg-primary text-primary-foreground shadow-lg" : "text-muted-foreground hover:text-white"}`}
           >
              Fortuna
           </button>
           <button 
             onClick={() => setTab("prestigio")}
             className={`flex-1 py-4 rounded-[1.8rem] text-[10px] font-black uppercase tracking-[0.1em] transition-all ${tab === "prestigio" ? "bg-primary text-primary-foreground shadow-lg" : "text-muted-foreground hover:text-white"}`}
           >
              Prestígio
           </button>
        </div>
      </header>

      {data === null ? (
        <div className="space-y-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-20 rounded-[2rem] bg-card animate-pulse border border-white/5" />
          ))}
        </div>
      ) : (
        <ol className="space-y-4">
          {sorted.map((a, i) => (
            <li 
              key={a.nome} 
              className={`group flex items-center gap-4 p-4 rounded-[2.5rem] bg-card border border-white/5 transition-all hover:bg-white/[0.03] active:scale-[0.98] ${i === 0 ? "border-primary/20 bg-primary/5" : ""}`}
            >
              <div className="relative size-14 shrink-0">
                <img
                  src={driveImg(a.foto)}
                  alt={a.nome}
                  loading="lazy"
                  className="w-full h-full rounded-2xl object-cover grayscale opacity-80 group-hover:grayscale-0 group-hover:opacity-100 transition-all duration-500"
                 decoding="async"/>
                <div className={`absolute -top-2 -left-2 size-6 rounded-lg grid place-items-center text-[10px] font-black shadow-lg ${i === 0 ? "bg-amber-400 text-black" : i === 1 ? "bg-zinc-300 text-black" : i === 2 ? "bg-amber-700 text-white" : "bg-black text-white border border-white/10"}`}>
                   {i + 1}
                </div>
              </div>

              <div className="flex-1 min-w-0">
                <h3 className="font-black italic uppercase tracking-tight truncate text-base leading-tight group-hover:text-primary transition-colors">
                   {a.nome}
                </h3>
                <div className="flex items-center gap-2 mt-0.5">
                   <div className="size-1.5 rounded-full bg-emerald-500" />
                   <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60">{a.gravadora}</span>
                </div>
              </div>

              <div className="text-right">
                 {tab === "fortuna" ? (
                    <div className="flex flex-col items-end">
                       <span className="text-lg font-black italic tracking-tighter text-primary">{fmtMoney(a.fortuna_total)}</span>
                       <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/50">Fortuna Total</span>
                    </div>
                 ) : (
                    <div className="flex flex-col items-end">
                       <div className="flex items-center gap-1.5">
                          <Crown className="size-4 text-amber-400" />
                          <span className="text-lg font-black italic tracking-tighter text-amber-400">{a.prestigio}</span>
                       </div>
                       <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/50">Prestígio</span>
                    </div>
                 )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}

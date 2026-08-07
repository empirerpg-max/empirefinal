import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Building2 } from "lucide-react";
import { api, fmtMoney, type Artist } from "@/lib/api";

export const Route = createFileRoute("/gravadoras")({ component: Gravadoras });

function Gravadoras() {
  const [data, setData] = useState<Artist[] | null>(null);
  useEffect(() => {
    api.listarTodos().then(setData);
  }, []);

  const labels = useMemo(() => {
    const map = new Map<
      string,
      { nome: string; artistas: number; prestigio: number; fortuna: number }
    >();
    (data || []).forEach((a) => {
      const key = a.gravadora || "Independent";
      const cur = map.get(key) || { nome: key, artistas: 0, prestigio: 0, fortuna: 0 };
      cur.artistas += 1;
      cur.prestigio += a.prestigio;
      cur.fortuna += a.fortuna_total;
      map.set(key, cur);
    });
    return Array.from(map.values()).sort((a, b) => b.prestigio - a.prestigio);
  }, [data]);

  return (
    <main className="flex-1 mx-auto w-full max-w-2xl px-4 pt-6">
      <header className="mb-6 flex items-center gap-4">
        <Building2 className="size-10 text-primary" />
        <div>
          <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-black">
            As majors
          </p>
          <h1 className="text-3xl font-black italic uppercase tracking-tighter">Gravadoras</h1>
        </div>
      </header>
      {data === null ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-20 rounded-3xl bg-card animate-pulse" />
          ))}
        </div>
      ) : (
        <ol className="space-y-3">
          {labels.map((g, i) => (
            <li key={g.nome} className="flex items-center gap-4 p-4 rounded-3xl bg-card border border-white/5 shadow-lg group hover:border-primary/20 transition-all">
              <span
                className={`w-8 text-center text-xl font-black italic ${i < 3 ? "text-primary scale-110" : "text-muted-foreground/30"}`}
              >
                {i + 1}
              </span>
              <div className="size-14 rounded-2xl bg-primary/10 text-primary grid place-items-center font-black text-lg shadow-inner group-hover:scale-105 transition-transform">
                {g.nome.slice(0, 2).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-black uppercase tracking-tight text-base truncate group-hover:text-primary transition-colors">{g.nome}</p>
                <p className="text-[11px] text-muted-foreground font-bold uppercase tracking-wider opacity-60">
                  {g.artistas} artista{g.artistas !== 1 && "s"} • {fmtMoney(g.fortuna)}
                </p>
              </div>
              <div className="text-right">
                <span className="font-black text-xl italic tracking-tighter text-amber-400">{g.prestigio}</span>
                <p className="text-[11px] font-black uppercase text-muted-foreground/30 tracking-[0.1em]">Pontos</p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}

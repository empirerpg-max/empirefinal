import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Radio } from "lucide-react";
import { api, driveImg, type RadarItem } from "@/lib/api";

export const Route = createFileRoute("/radar")({
  component: RadarPage,
});

function RadarPage() {
  const [items, setItems] = useState<RadarItem[] | null>(null);
  useEffect(() => {
    api.radar().then(setItems);
  }, []);

  return (
    <main className="flex-1 mx-auto w-full max-w-2xl px-4 pt-6">
      <header className="mb-5 flex items-center gap-3">
        <Radio className="size-7 text-primary" />
        <div>
          <p className="text-xs uppercase tracking-widest text-muted-foreground font-bold">Feed</p>
          <h1 className="text-xl font-extrabold">Radar</h1>
        </div>
      </header>
      {items === null ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-16 rounded-xl bg-card animate-pulse" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <p className="text-center text-sm text-muted-foreground py-12">Sem atividade recente.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((r, i) => (
            <li key={i} className="flex items-center gap-3 p-2 rounded-xl bg-card">
              <img
                src={driveImg(r.foto)}
                alt={r.nome}
                loading="lazy"
                className="size-12 rounded-lg object-cover bg-secondary"
               decoding="async"/>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold truncate">{r.nome}</p>
                <p className="text-xs text-muted-foreground">{r.acao}</p>
              </div>
              <span className="text-[10px] text-muted-foreground/70 shrink-0">{r.timestamp}</span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

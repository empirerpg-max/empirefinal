import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Star } from "lucide-react";
import { api, fmtMoney, driveImg, type Artist } from "@/lib/api";

export const Route = createFileRoute("/hall")({
  component: Hall,
});

function Hall() {
  const [data, setData] = useState<Artist[] | null>(null);
  useEffect(() => {
    api.listarTodos().then(setData);
  }, []);

  // Hall da Fama: prestígio máximo (1000) ou top 10 por prestígio
  const hall = (data || []).filter((a) => a.prestigio >= 1000);
  const elite = (data || [])
    .slice()
    .sort((a, b) => b.prestigio - a.prestigio)
    .slice(0, 10);

  return (
    <main className="flex-1 mx-auto w-full max-w-2xl px-4 pt-6">
      <header className="mb-5 flex items-center gap-3">
        <Star className="size-7 text-primary" fill="currentColor" />
        <div>
          <p className="text-xs uppercase tracking-widest text-muted-foreground font-bold">
            Lendas
          </p>
          <h1 className="text-3xl font-extrabold">Hall da Fama</h1>
        </div>
      </header>

      {data === null ? (
        <div className="h-40 rounded-xl bg-card animate-pulse" />
      ) : (
        <>
          <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2">
            Imortais (prestígio 1000)
          </h2>
          {hall.length === 0 ? (
            <p className="text-sm text-muted-foreground mb-6">Ainda sem imortais.</p>
          ) : (
            <div className="grid grid-cols-3 gap-3 mb-6">
              {hall.map((a) => (
                <div key={a.nome} className="text-center">
                  <div className="aspect-square rounded-xl overflow-hidden bg-secondary mb-2 ring-2 ring-primary">
                    <img
                      src={driveImg(a.foto)}
                      alt={a.nome}
                      loading="lazy"
                      className="w-full h-full object-cover"
                     decoding="async"/>
                  </div>
                  <p className="text-xs font-bold truncate">{a.nome}</p>
                </div>
              ))}
            </div>
          )}

          <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2">
            Top 10 prestígio
          </h2>
          <ol className="space-y-2">
            {elite.map((a, i) => (
              <li key={a.nome} className="flex items-center gap-3 p-2 rounded-xl bg-card">
                <span
                  className={`w-7 text-center font-black ${i < 3 ? "text-primary" : "text-muted-foreground"}`}
                >
                  {i + 1}
                </span>
                <img
                  src={driveImg(a.foto)}
                  alt={a.nome}
                  loading="lazy"
                  className="size-12 rounded-lg object-cover bg-secondary"
                 decoding="async"/>
                <div className="flex-1 min-w-0">
                  <p className="font-bold truncate">{a.nome}</p>
                  <p className="text-xs text-muted-foreground">{fmtMoney(a.fortuna_total)}</p>
                </div>
                <span className="font-black text-sm">{a.prestigio}</span>
              </li>
            ))}
          </ol>
        </>
      )}
    </main>
  );
}

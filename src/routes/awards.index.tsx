import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ChevronLeft, Trophy, Loader2 } from "lucide-react";
import { api } from "@/lib/api";

export const Route = createFileRoute("/awards/")({
  component: AwardsIndexPage,
});

function AwardsIndexPage() {
  const navigate = useNavigate();
  const [awards, setAwards] = useState<{ nome: string; foto: string }[] | null>(null);

  useEffect(() => {
    api.listarAwards().then(setAwards).catch(() => setAwards([]));
  }, []);

  return (
    <div className="pb-24 px-4 pt-6 max-w-md mx-auto min-h-screen">
      <header className="flex items-center gap-3 mb-6">
        <button
          onClick={() => navigate({ to: "/acervo" })}
          className="size-9 rounded-full bg-white/5 border border-white/10 grid place-items-center"
        >
          <ChevronLeft className="size-5" />
        </button>
        <div>
          <h1 className="text-lg font-black uppercase tracking-tight flex items-center gap-2">
            <Trophy className="size-5 text-primary" /> Awards
          </h1>
          <p className="text-[11px] text-muted-foreground">
            Histórico completo de vencedores e indicados de cada premiação.
          </p>
        </div>
      </header>

      {awards === null ? (
        <div className="flex items-center justify-center p-20">
          <Loader2 className="size-8 text-primary animate-spin" />
        </div>
      ) : awards.length === 0 ? (
        <p className="text-center text-sm text-muted-foreground py-16">
          Nenhum award cadastrado ainda.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {awards.map((a) => (
            <Link
              key={a.nome}
              to="/awards/$nome"
              params={{ nome: a.nome }}
              className="group relative aspect-[4/5] rounded-3xl overflow-hidden border border-white/10 bg-neutral-900"
            >
              {a.foto && (
                <img
                  src={a.foto}
                  alt=""
                  referrerPolicy="no-referrer"
                  className="absolute inset-0 w-full h-full object-cover opacity-70 group-active:scale-105 transition-transform duration-300"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.display = "none";
                  }}
                />
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-black/10" />
              <div className="absolute inset-x-0 bottom-0 p-3">
                <p className="text-sm font-black uppercase leading-tight tracking-tight text-white drop-shadow">
                  {a.nome}
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

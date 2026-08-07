import { createFileRoute, Link } from "@tanstack/react-router";
import { Brain, Camera, ChevronLeft, Gamepad2, Heart, Music4, Play } from "lucide-react";

export const Route = createFileRoute("/games/")({
  component: GamesHub,
});

const games = [
  {
    id: "hits-producer",
    title: "O Produtor de Hits",
    description:
      "Acerte as notas no ritmo. Combo + precisão multiplicam sua aposta em E$C.",
    tag: "Ritmo",
    risk: "Risco alto",
    route: "/games/hits-producer" as const,
    icon: Music4,
  },
  {
    id: "paparazzi-escape",
    title: "Fuga do Paparazzi",
    description:
      "3 pistas, pulo e esquiva. Colete moedas e clique FUGIR antes do flash final.",
    tag: "Runner 3D",
    risk: "Risco alto",
    route: "/games/paparazzi-escape" as const,
    icon: Camera,
  },
  {
    id: "memoria-fama",
    title: "Memória da Fama",
    description:
      "Grade 4×4 com seus artistas. 60s. Sem erros = FLAWLESS e prêmio até 3× a entrada.",
    tag: "Memória",
    risk: "Risco médio",
    route: "/games/memoria-fama" as const,
    icon: Brain,
  },
  {
    id: "queridometro",
    title: "Queridômetro",
    description:
      "Mande emoji pra qualquer artista. Prestígio entregue às cegas (de -20 a +20).",
    tag: "Social",
    risk: "Mistério",
    route: "/games/queridometro" as const,
    icon: Heart,
  },
];

function GamesHub() {
  return (
    <main className="flex-1 mx-auto w-full max-w-2xl px-4 pt-6 pb-32">
      <Link
        to="/"
        className="inline-flex items-center gap-1 text-muted-foreground mb-6 font-black uppercase text-[11px] hover:text-primary transition-colors"
      >
        <ChevronLeft className="size-4" /> Painel Geral
      </Link>

      <header className="mb-8">
        <div className="size-14 rounded-2xl bg-primary/15 text-primary grid place-items-center mb-4">
          <Gamepad2 className="size-7" />
        </div>
        <h1 className="text-3xl font-black italic uppercase tracking-tighter">
          Empire <span className="text-primary">Games</span>
        </h1>
        <p className="text-muted-foreground text-[11px] font-bold mt-1 uppercase tracking-widest">
          Aposte E$C, ganhe E$C
        </p>
      </header>

      <div className="grid grid-cols-1 gap-3">
        {games.map((g) => {
          const Icon = g.icon;
          return (
            <Link
              key={g.id}
              to={g.route}
              className="group flex items-center gap-4 p-5 rounded-3xl bg-card border border-white/5 hover:bg-white/[0.04] active:scale-[0.98] transition-all"
            >
              <div className="size-14 rounded-2xl bg-primary/15 text-primary grid place-items-center shrink-0">
                <Icon className="size-7" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] uppercase font-black tracking-widest text-primary">
                    {g.tag}
                  </span>
                  <span className="text-[10px] uppercase font-black tracking-widest text-muted-foreground">
                    · {g.risk}
                  </span>
                </div>
                <h2 className="text-base font-black tracking-tight truncate">
                  {g.title}
                </h2>
                <p className="text-[11px] text-muted-foreground font-medium truncate italic">
                  {g.description}
                </p>
              </div>
              <div className="size-10 rounded-full bg-primary text-primary-foreground grid place-items-center shrink-0 group-hover:scale-110 transition-transform">
                <Play className="size-4 fill-current" />
              </div>
            </Link>
          );
        })}
      </div>
    </main>
  );
}

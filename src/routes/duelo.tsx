import { createFileRoute, Link } from "@tanstack/react-router";
import { BackButton } from "@/components/BackButton";
import { useEffect, useState } from "react";
import { ChevronLeft, Swords, Loader2, Trophy } from "lucide-react";
import { api, driveImg, type Artist } from "@/lib/api";
import { useTelegramUser } from "@/lib/telegram";
import { motion, AnimatePresence } from "motion/react";

export const Route = createFileRoute("/duelo")({
  component: DueloPage,
});

function DueloPage() {
  const { user, ready } = useTelegramUser();
  const [artists, setArtists] = useState<Artist[]>([]);
  const [allArtists, setAllArtists] = useState<Artist[]>([]);
  const [loading, setLoading] = useState(true);

  // States
  const [p1, setP1] = useState<Artist | null>(null);
  const [p2, setP2] = useState<Artist | null>(null);
  const [fighting, setFighting] = useState(false);
  const [winner, setWinner] = useState<Artist | null>(null);
  const [log, setLog] = useState<string[]>([]);

  const [h1, setH1] = useState(100);
  const [h2, setH2] = useState(100);

  useEffect(() => {
    if (!ready || !user) return;
    Promise.all([api.meusArtistas(user.id), api.listarTodos()]).then(([meus, todos]) => {
      setArtists(meus);
      setAllArtists(todos.filter((t) => !meus.some((m) => m.nome === t.nome)));
      if (meus.length > 0) setP1(meus[0]);
      setLoading(false);
    });
  }, [ready, user]);

  async function startDuel() {
    if (!p1 || !p2) return;
    setFighting(true);
    setWinner(null);
    setH1(100);
    setH2(100);
    setLog(["O duelo começou!", `${p1.nome} vs ${p2.nome}`]);

    const runTurn = (health1: number, health2: number) => {
      if (health1 <= 0 || health2 <= 0) {
        const win = health1 > 0 ? p1 : p2;
        setWinner(win);
        setFighting(false);
        setLog((prev) => [...prev, `🏆 ${win.nome} VENCEU O DUELO!`]);
        return;
      }

      setTimeout(() => {
        const turn = Math.random() > 0.5 ? 1 : 2;
        const crit = Math.random() > 0.8;
        const dmg = Math.floor(Math.random() * 15) + 5 + (crit ? 10 : 0);

        if (turn === 1) {
          const nextH2 = Math.max(0, health2 - dmg);
          setH2(nextH2);
          setLog((prev) => [
            ...prev.slice(-3),
            `${p1.nome} usou um hit ${crit ? "CRÍTICO" : ""}${"!"} Dano: ${dmg}`,
          ]);
          runTurn(health1, nextH2);
        } else {
          const nextH1 = Math.max(0, health1 - dmg);
          setH1(nextH1);
          setLog((prev) => [...prev.slice(-3), `${p2.nome} lançou um shade${"!"} Dano: ${dmg}`]);
          runTurn(nextH1, health2);
        }
      }, 800);
    };

    runTurn(100, 100);
  }

  if (loading) {
    return (
      <main className="flex-1 grid place-items-center">
        <Loader2 className="size-10 animate-spin text-primary" />
      </main>
    );
  }

  return (
    <main className="flex-1 mx-auto w-full max-w-2xl px-4 pt-6 pb-20 overflow-hidden">
      <BackButton />

      <header className="mb-8 text-center">
        <div className="size-12 rounded-xl bg-red-500/15 text-red-500 grid place-items-center mb-4 mx-auto">
          <Swords className="size-6" />
        </div>
        <h1 className="text-3xl font-black italic uppercase tracking-tighter">Arena de Duelos</h1>
        <p className="text-muted-foreground mt-2 text-sm italic">
          Onde as carreiras são postas à prova.
        </p>
      </header>

      {!fighting && !winner && (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase text-muted-foreground px-1">
                Seu Gladiador
              </label>
              <select
                value={p1?.nome || ""}
                onChange={(e) => setP1(artists.find((a) => a.nome === e.target.value) || null)}
                className="w-full bg-card border border-border rounded-xl p-3 text-sm font-bold"
              >
                {artists.map((a) => (
                  <option key={a.nome} value={a.nome}>
                    {a.nome}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase text-muted-foreground px-1">
                Oponente
              </label>
              <select
                value={p2?.nome || ""}
                onChange={(e) => setP2(allArtists.find((a) => a.nome === e.target.value) || null)}
                className="w-full bg-card border border-border rounded-xl p-3 text-sm font-bold"
              >
                <option value="">Escolher...</option>
                {allArtists.map((a) => (
                  <option key={a.nome} value={a.nome}>
                    {a.nome}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <button
            onClick={startDuel}
            disabled={!p1 || !p2}
            className="w-full py-6 rounded-2xl bg-red-600 text-white font-black text-xl italic uppercase tracking-widest shadow-xl shadow-red-600/30 disabled:opacity-30 disabled:grayscale transition-all active:scale-95"
          >
            INICIAR DUELO
          </button>
        </div>
      )}

      {(fighting || winner) && (
        <div className="space-y-8 py-4">
          <div className="flex items-center justify-between gap-4 relative h-48">
            <motion.div
              animate={fighting && h1 < 100 ? { x: [0, -10, 0] } : {}}
              className="flex flex-col items-center gap-2"
            >
              <div className="size-24 sm:size-32 rounded-3xl overflow-hidden border-4 border-primary shadow-2xl relative">
                <img
                  src={p1 ? (driveImg(p1.foto, 300) as string) : undefined}
                  className="w-full h-full object-cover"
                  alt=""
                 loading="lazy" decoding="async"/>
                {winner === p1 && (
                  <div className="absolute inset-0 bg-primary/20 grid place-items-center">
                    <Trophy className="size-12 text-white drop-shadow-lg" />
                  </div>
                )}
              </div>
              <div className="w-full bg-secondary h-3 rounded-full overflow-hidden border border-border">
                <div
                  className="bg-red-500 h-full transition-all duration-300"
                  style={{ width: `${h1}%` }}
                />
              </div>
              <p className="font-black italic text-xs uppercase">{p1?.nome}</p>
            </motion.div>

            <Swords className="size-8 text-muted-foreground/30 animate-pulse" />

            <motion.div
              animate={fighting && h2 < 100 ? { x: [0, 10, 0] } : {}}
              className="flex flex-col items-center gap-2"
            >
              <div className="size-24 sm:size-32 rounded-3xl overflow-hidden border-4 border-destructive shadow-2xl relative">
                <img
                  src={p2 ? (driveImg(p2.foto, 300) as string) : undefined}
                  className="w-full h-full object-cover"
                  alt=""
                 loading="lazy" decoding="async"/>
                {winner === p2 && (
                  <div className="absolute inset-0 bg-destructive/20 grid place-items-center">
                    <Trophy className="size-12 text-white drop-shadow-lg" />
                  </div>
                )}
              </div>
              <div className="w-full bg-secondary h-3 rounded-full overflow-hidden border border-border">
                <div
                  className="bg-red-500 h-full transition-all duration-300"
                  style={{ width: `${h2}%` }}
                />
              </div>
              <p className="font-black italic text-xs uppercase">{p2?.nome}</p>
            </motion.div>
          </div>

          <div className="bg-card border border-border rounded-2xl p-4 h-32 overflow-hidden flex flex-col justify-end">
            <AnimatePresence mode="popLayout">
              {log.map((line, i) => (
                <motion.p
                  key={i}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`text-sm font-bold leading-tight mb-1 ${line.includes("🏆") ? "text-primary" : "text-muted-foreground"}`}
                >
                  {line}
                </motion.p>
              ))}
            </AnimatePresence>
          </div>

          {winner && (
            <button
              onClick={() => {
                setWinner(null);
                setFighting(false);
                setLog([]);
              }}
              className="w-full py-4 rounded-xl bg-secondary text-foreground font-bold hover:bg-card border border-border transition-colors animate-in fade-in slide-in-from-bottom-2"
            >
              VOLTAR À ARENA
            </button>
          )}
        </div>
      )}

      <div className="mt-12 space-y-4">
        <h3 className="text-xs font-black uppercase tracking-widest text-muted-foreground px-1">
          Próximos Duelos
        </h3>
        <div className="grid grid-cols-1 gap-2">
          <div className="p-3 rounded-xl bg-card/40 border border-border/50 flex items-center justify-between text-xs text-muted-foreground italic">
            <span>Matchmaking em andamento...</span>
            <div className="flex -space-x-2">
              <div className="size-6 rounded-full bg-secondary border border-border" />
              <div className="size-6 rounded-full bg-muted border border-border" />
              <div className="size-6 rounded-full bg-secondary border border-border" />
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

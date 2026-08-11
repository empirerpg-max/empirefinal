import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Target, Loader2, Sparkles, ListMusic, ChevronRight } from "lucide-react";
import { api } from "@/lib/api";
import { useTelegramUser } from "@/lib/telegram";

export const Route = createFileRoute("/ponto/")({
  component: PontoHome,
});

function PontoHome() {
  const { user, ready } = useTelegramUser();
  const [data, setData] = useState<{ nomeOff?: string; artistas?: string[]; erro?: string } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!ready) return;
    if (!user?.id) {
      setLoading(false);
      return;
    }
    api.getJogador(String(user.id)).then((r) => {
      setData(r);
      setLoading(false);
    });
  }, [user, ready]);

  if (!ready || loading) {
    return (
      <main className="flex-1 grid place-items-center min-h-[60vh]">
        <Loader2 className="size-8 animate-spin text-emerald-500" />
      </main>
    );
  }

  if (!user?.id) {
    return (
      <main className="flex-1 mx-auto w-full max-w-md px-6 pt-12 text-center">
        <Target className="size-12 text-neutral-700 mx-auto mb-4" />
        <h1 className="text-xl font-black uppercase text-white">Identifique-se</h1>
        <p className="text-sm text-neutral-500 mt-2">
          Abra o app pelo Telegram para acessar o Ponto.
        </p>
      </main>
    );
  }

  if (data?.erro || !data?.nomeOff) {
    return (
      <main className="flex-1 mx-auto w-full max-w-md px-6 pt-12 text-center">
        <Target className="size-12 text-neutral-700 mx-auto mb-4" />
        <h1 className="text-xl font-black uppercase text-white">Jogador não encontrado</h1>
        <p className="text-sm text-neutral-500 mt-2">
          {data?.erro || "Seu Telegram ID não está cadastrado na aba Jogadores."}
        </p>
      </main>
    );
  }

  return (
    <main className="flex-1 mx-auto w-full max-w-md px-6 pt-10 pb-24">
      <header className="mb-8">
        <div className="size-14 rounded-2xl bg-emerald-500/15 text-emerald-500 grid place-items-center mb-4">
          <Target className="size-7" />
        </div>
        <p className="text-[10px] font-black uppercase tracking-widest text-emerald-500">Ponto</p>
        <h1 className="text-3xl font-black italic tracking-tighter mt-1 text-white">Oi, {data.nomeOff}.</h1>
        <p className="text-sm text-neutral-500 mt-1">O que você quer fazer?</p>
        {data.artistas && data.artistas.length > 0 && (
          <p className="text-[11px] text-neutral-600 mt-3">
            Artistas: {data.artistas.join(" · ")}
          </p>
        )}
      </header>

      <div className="space-y-2">
        <Link
          to="/ponto/distribuir"
          className="flex items-center gap-4 p-4 rounded-2xl bg-neutral-900 border border-white/10 hover:border-emerald-500/40 hover:bg-neutral-800 transition-colors group"
        >
          <div className="size-12 rounded-2xl bg-emerald-500/15 text-emerald-500 grid place-items-center shrink-0 group-hover:scale-105 transition-transform">
            <Sparkles className="size-6" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="font-black uppercase tracking-tight text-white text-sm">Distribuir pontos</h2>
            <p className="text-xs text-neutral-500">Aleatório ou manual</p>
          </div>
          <ChevronRight className="size-4 text-neutral-600 group-hover:text-emerald-500 transition-colors shrink-0" />
        </Link>

        <Link
          to="/ponto/playlists"
          className="flex items-center gap-4 p-4 rounded-2xl bg-neutral-900 border border-white/10 hover:border-emerald-500/40 hover:bg-neutral-800 transition-colors group"
        >
          <div className="size-12 rounded-2xl bg-emerald-500/15 text-emerald-500 grid place-items-center shrink-0 group-hover:scale-105 transition-transform">
            <ListMusic className="size-6" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="font-black uppercase tracking-tight text-white text-sm">Aplicar playlists</h2>
            <p className="text-xs text-neutral-500">Conforme saldo ou manual</p>
          </div>
          <ChevronRight className="size-4 text-neutral-600 group-hover:text-emerald-500 transition-colors shrink-0" />
        </Link>
      </div>
    </main>
  );
}

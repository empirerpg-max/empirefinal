import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Target, Loader2, Sparkles, ListMusic } from "lucide-react";
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
        <Loader2 className="size-8 animate-spin text-primary" />
      </main>
    );
  }

  if (!user?.id) {
    return (
      <main className="flex-1 mx-auto w-full max-w-md px-6 pt-12 text-center">
        <Target className="size-12 text-muted-foreground/30 mx-auto mb-4" />
        <h1 className="text-xl font-black uppercase">Identifique-se</h1>
        <p className="text-sm text-muted-foreground mt-2">
          Abra o app pelo Telegram para acessar o Ponto.
        </p>
      </main>
    );
  }

  if (data?.erro || !data?.nomeOff) {
    return (
      <main className="flex-1 mx-auto w-full max-w-md px-6 pt-12 text-center">
        <Target className="size-12 text-muted-foreground/30 mx-auto mb-4" />
        <h1 className="text-xl font-black uppercase">Jogador não encontrado</h1>
        <p className="text-sm text-muted-foreground mt-2">
          {data?.erro || "Seu Telegram ID não está cadastrado na aba Jogadores."}
        </p>
      </main>
    );
  }

  return (
    <main className="flex-1 mx-auto w-full max-w-md px-6 pt-10 pb-24">
      <header className="mb-8">
        <div className="size-14 rounded-2xl bg-primary/15 text-primary grid place-items-center mb-4">
          <Target className="size-7" />
        </div>
        <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Ponto</p>
        <h1 className="text-3xl font-black italic tracking-tighter mt-1">Oi, {data.nomeOff}.</h1>
        <p className="text-sm text-muted-foreground mt-1">O que você quer fazer?</p>
        {data.artistas && data.artistas.length > 0 && (
          <p className="text-[11px] text-muted-foreground/60 mt-3">
            Artistas: {data.artistas.join(" · ")}
          </p>
        )}
      </header>

      <div className="space-y-3">
        <Link
          to="/ponto/distribuir"
          className="block p-5 rounded-3xl bg-card border border-white/5 hover:border-primary/40 transition-colors group"
        >
          <div className="flex items-center gap-4">
            <div className="size-12 rounded-2xl bg-primary/10 text-primary grid place-items-center group-hover:scale-110 transition-transform">
              <Sparkles className="size-6" />
            </div>
            <div>
              <h2 className="font-black uppercase tracking-tight">Distribuir pontos</h2>
              <p className="text-xs text-muted-foreground">Aleatório ou manual</p>
            </div>
          </div>
        </Link>

        <Link
          to="/ponto/playlists"
          className="block p-5 rounded-3xl bg-card border border-white/5 hover:border-primary/40 transition-colors group"
        >
          <div className="flex items-center gap-4">
            <div className="size-12 rounded-2xl bg-primary/10 text-primary grid place-items-center group-hover:scale-110 transition-transform">
              <ListMusic className="size-6" />
            </div>
            <div>
              <h2 className="font-black uppercase tracking-tight">Aplicar playlists</h2>
              <p className="text-xs text-muted-foreground">Conforme saldo ou manual</p>
            </div>
          </div>
        </Link>
      </div>
    </main>
  );
}

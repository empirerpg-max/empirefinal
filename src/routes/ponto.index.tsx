import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Target, Loader2, Sparkles, ListMusic, ChevronRight, ClipboardList } from "lucide-react";
import { api } from "@/lib/api";
import { useTelegramUser } from "@/lib/telegram";
import { getStoredLogin } from "@/components/LoginScreen";

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
    // Mesma fonte de posse usada por Distribuir/Playlists (aba ARTISTAS via
    // nosso backend) — a antiga acao "ponto_get_jogador" do Apps Script
    // checava outra aba (Jogadores) e dava "jogador não encontrado" pra
    // quem estava corretamente vinculado só na aba nova.
    api
      .listarPontos(String(user.id))
      .then((r) => {
        setData({ nomeOff: getStoredLogin()?.nome || user.name, artistas: r.artistas });
        setLoading(false);
      })
      .catch(() => {
        setData({ erro: "Não foi possível carregar seus artistas." });
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

  const acoes = [
    { to: "/ponto/distribuir" as const, icon: Sparkles, titulo: "Distribuir pontos", subtitulo: "Aleatório ou manual" },
    { to: "/ponto/playlists" as const, icon: ListMusic, titulo: "Aplicar playlists", subtitulo: "Conforme saldo ou manual" },
    { to: "/ponto/valores" as const, icon: ClipboardList, titulo: "O que vale ponto", subtitulo: "Tabela de referência" },
  ];

  return (
    <main className="flex-1 mx-auto w-full max-w-md px-5 pt-8 pb-24">
      {/* Cartão de topo — vidro discreto, sem cor forte: só o essencial. */}
      <header className="mb-5 p-5 rounded-[1.75rem] bg-white/[0.025] border border-white/[0.06] backdrop-blur-xl">
        <div className="flex items-center justify-between">
          <div className="size-11 rounded-full bg-white/[0.06] text-white/70 grid place-items-center">
            <Target className="size-5" strokeWidth={1.75} />
          </div>
          <span className="px-2.5 py-1 rounded-full border border-white/10 text-[9px] font-semibold uppercase tracking-widest text-white/40">
            Ponto
          </span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight mt-4 text-white">Oi, {data.nomeOff}.</h1>
        <p className="text-sm text-white/40 mt-0.5">O que você quer fazer?</p>

        {data.artistas && data.artistas.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-4">
            {data.artistas.map((nome) => (
              <span
                key={nome}
                className="flex items-center gap-1.5 pl-1 pr-2.5 py-1 rounded-full bg-white/[0.04] border border-white/[0.06] text-[11px] font-medium text-white/60"
              >
                <span className="size-4 rounded-full bg-white/[0.08] text-white/50 text-[8px] font-bold grid place-items-center shrink-0">
                  {nome.charAt(0).toUpperCase()}
                </span>
                {nome}
              </span>
            ))}
          </div>
        )}
      </header>

      <div className="space-y-2">
        {acoes.map(({ to, icon: Icon, titulo, subtitulo }) => (
          <Link
            key={to}
            to={to}
            className="flex items-center gap-3.5 p-4 rounded-[1.5rem] bg-white/[0.025] border border-white/[0.06] backdrop-blur-xl hover:bg-white/[0.05] hover:border-white/[0.12] transition-all active:scale-[0.98] group"
          >
            <div className="size-10 rounded-full bg-white/[0.06] text-white/60 grid place-items-center shrink-0 group-hover:bg-white/[0.1] group-hover:text-white/80 transition-colors">
              <Icon className="size-4.5" strokeWidth={1.75} />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="font-semibold text-white text-[15px] tracking-tight">{titulo}</h2>
              <p className="text-[13px] text-white/35">{subtitulo}</p>
            </div>
            <ChevronRight className="size-4 text-white/25 group-hover:text-white/60 group-hover:translate-x-0.5 transition-all shrink-0" />
          </Link>
        ))}
      </div>
    </main>
  );
}

import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { User, LogOut, ChevronRight, Library, Crown } from "lucide-react";
import { useTelegramUser, haptic } from "@/lib/telegram";
import { api, driveImg, fmtEC, type Artist } from "@/lib/api";
import { getStoredLogin, clearStoredLogin } from "@/components/LoginScreen";

export const Route = createFileRoute("/perfil")({
  component: Perfil,
});

type LoadState<T> = { status: "loading" } | { status: "error" } | { status: "ok"; data: T };

function Perfil() {
  const { user } = useTelegramUser();
  const login = getStoredLogin();
  const [myArtists, setMyArtists] = useState<LoadState<Artist[]>>({ status: "loading" });

  useEffect(() => {
    if (!user || user.id === "guest") {
      setMyArtists({ status: "ok", data: [] });
      return;
    }
    api
      .meusArtistas(user.id)
      .then((d) => setMyArtists({ status: "ok", data: d }))
      .catch(() => setMyArtists({ status: "error" }));
  }, [user]);

  const openLinkModal = () => {
    haptic.light();
    (window as any).setShowLinkModal?.(true);
  };

  return (
    <div className="pb-24 px-4 pt-6 max-w-md mx-auto min-h-screen">
      <header className="flex flex-col items-center text-center mb-8">
        <div className="size-24 rounded-full bg-primary/20 border-2 border-primary/30 grid place-items-center overflow-hidden mb-4">
          {login?.fotoPerfil || user?.photo_url ? (
            <img
              src={driveImg(login?.fotoPerfil || user?.photo_url || "", 200)}
              className="size-24 rounded-full object-cover"
              alt={login?.nome || user?.name || "Foto do jogador"}
            />
          ) : (
            <User className="size-10 text-primary" />
          )}
        </div>
        <h1 className="text-xl font-black uppercase tracking-tight">
          {login?.nome || user?.name || "Jogador"}
        </h1>
        {login?.tipoPerfil && (
          <span className="mt-1 px-3 py-1 rounded-full bg-primary/10 border border-primary/30 text-primary text-[10px] font-black uppercase tracking-wider">
            {login.tipoPerfil}
          </span>
        )}
      </header>

      <section className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-black uppercase tracking-[0.2em]">Meus Artistas</h2>
          <button
            onClick={openLinkModal}
            className="text-[11px] font-bold uppercase text-primary tracking-wider hover:underline"
          >
            Gerenciar
          </button>
        </div>

        {myArtists.status === "loading" ? (
          <div className="space-y-2">
            {[1, 2].map((i) => (
              <div key={i} className="h-16 rounded-2xl bg-white/5 animate-pulse" />
            ))}
          </div>
        ) : myArtists.status === "ok" && myArtists.data.length > 0 ? (
          <div className="space-y-2">
            {myArtists.data.map((a) => (
              <Link
                key={a.nome}
                to="/artistas/$nome"
                params={{ nome: a.nome }}
                onClick={() => haptic.selection()}
                className="flex items-center gap-3 p-3 rounded-2xl bg-white/5 border border-white/10 hover:bg-white/[0.08] transition-all"
              >
                <div className="size-12 rounded-xl bg-secondary overflow-hidden flex-shrink-0 border border-white/10">
                  <img
                    src={driveImg(a.foto, 100)}
                    className="w-full h-full object-cover"
                    alt={a.nome}
                    loading="lazy"
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-black uppercase truncate">{a.nome}</p>
                  <p className="text-[11px] font-bold text-primary/80">{fmtEC(a.saldo)}</p>
                </div>
                <ChevronRight className="size-4 text-muted-foreground" />
              </Link>
            ))}
          </div>
        ) : (
          <button
            onClick={openLinkModal}
            className="w-full p-6 rounded-2xl bg-card/50 border-2 border-dashed border-primary/20 flex flex-col items-center text-center hover:bg-primary/5 transition-all"
          >
            <Library className="size-8 text-primary mb-2" />
            <p className="text-sm font-black uppercase">Vincule seu primeiro artista</p>
          </button>
        )}
      </section>

      <section className="space-y-2">
        <Link
          to="/artistas"
          search={{ filter: "all" }}
          onClick={() => haptic.selection()}
          className="flex items-center gap-4 p-4 rounded-2xl bg-white/[0.02] border border-white/5 hover:bg-white/[0.06] transition-all"
        >
          <Crown className="size-5 text-primary" />
          <span className="flex-1 font-black uppercase text-xs tracking-widest">
            Todos os Artistas do Empire
          </span>
          <ChevronRight className="size-4 text-muted-foreground" />
        </Link>
        <button
          onClick={() => {
            clearStoredLogin();
            localStorage.removeItem("tg_user_cache");
            window.location.reload();
          }}
          className="w-full flex items-center gap-4 p-4 rounded-2xl bg-white/[0.02] border border-white/5 text-muted-foreground hover:text-red-400 hover:border-red-500/20 transition-all"
        >
          <LogOut className="size-5" />
          <span className="font-black uppercase text-xs tracking-widest">Sair</span>
        </button>
      </section>
    </div>
  );
}

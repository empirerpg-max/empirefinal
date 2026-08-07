import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Camera, ChevronLeft, Loader2, Play, Wallet } from "lucide-react";
import { useTelegramUser } from "@/lib/telegram";
import { api, fmtEC, type Artist } from "@/lib/api";

export const Route = createFileRoute("/games/paparazzi-escape")({
  component: PaparazziEscapePage,
});

function PaparazziEscapePage() {
  const { user, ready } = useTelegramUser();
  const [artists, setArtists] = useState<Artist[] | null>(null);
  const [selected, setSelected] = useState<string>("");
  const [launched, setLaunched] = useState(false);

  useEffect(() => {
    if (!ready || !user) return;
    api.meusArtistas(user.id).then((a) => {
      setArtists(a);
      if (a.length === 1) setSelected(a[0].nome);
    });
  }, [ready, user]);

  const artist = useMemo(
    () => artists?.find((a) => a.nome === selected) || null,
    [artists, selected],
  );

  if (launched && artist && user) {
    const src = `/games/paparazzi-escape/index.html?tg=${encodeURIComponent(user.id)}&artist=${encodeURIComponent(artist.nome)}`;
    return (
      <div className="fixed inset-0 z-[100] bg-black">
        <iframe
          src={src}
          title="Fuga do Paparazzi"
          className="w-full h-full border-0 block"
          allow="autoplay; fullscreen"
        />
        <button
          onClick={() => setLaunched(false)}
          className="absolute top-3 left-3 z-10 px-3 py-2 rounded-full bg-black/60 backdrop-blur text-white text-[11px] font-black uppercase tracking-widest border border-white/15 active:scale-95"
        >
          ← Sair
        </button>
      </div>
    );
  }

  return (
    <main className="flex-1 mx-auto w-full max-w-2xl px-4 pt-6 pb-32">
      <Link
        to="/games"
        className="inline-flex items-center gap-1 text-muted-foreground mb-6 font-black uppercase text-[11px] hover:text-primary transition-colors"
      >
        <ChevronLeft className="size-4" /> Empire Games
      </Link>

      <header className="mb-8">
        <div className="size-14 rounded-2xl bg-primary/15 text-primary grid place-items-center mb-4">
          <Camera className="size-7" />
        </div>
        <h1 className="text-3xl font-black italic uppercase tracking-tighter">
          Fuga do <span className="text-primary">Paparazzi</span>
        </h1>
        <p className="text-muted-foreground text-[11px] font-bold mt-1 uppercase tracking-widest">
          3 pistas · Pule · Esquive · 50 E$C de entrada
        </p>
      </header>

      <section className="rounded-3xl border border-white/5 bg-card p-6 mb-6">
        <p className="text-[10px] uppercase font-black tracking-widest text-muted-foreground mb-3">
          Selecione o artista que vai correr
        </p>

        {!ready || artists === null ? (
          <div className="flex items-center gap-2 text-muted-foreground text-xs py-4">
            <Loader2 className="size-4 animate-spin" /> Carregando seu elenco…
          </div>
        ) : artists.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4">
            Você não tem artistas vinculados. Vincule um artista no painel
            principal antes de jogar.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-2">
            {artists.map((a) => {
              const active = selected === a.nome;
              return (
                <button
                  key={a.nome}
                  onClick={() => setSelected(a.nome)}
                  className={`flex items-center gap-3 p-3 rounded-2xl border transition-all text-left ${
                    active
                      ? "border-primary bg-primary/10"
                      : "border-white/10 bg-background hover:bg-white/[0.04]"
                  }`}
                >
                  <div
                    className="size-10 rounded-xl bg-secondary overflow-hidden bg-cover bg-center shrink-0"
                    style={{ backgroundImage: a.foto ? `url(${a.foto})` : undefined }}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-black truncate">{a.nome}</p>
                    <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold flex items-center gap-1">
                      <Wallet className="size-3" /> {fmtEC(a.saldo)}
                    </p>
                  </div>
                  {active && (
                    <span className="text-[10px] font-black uppercase tracking-widest text-primary">
                      Selecionado
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </section>

      <button
        disabled={!artist}
        onClick={() => setLaunched(true)}
        className="w-full py-5 rounded-[2rem] bg-primary text-primary-foreground font-black uppercase text-xs tracking-widest shadow-xl shadow-primary/30 disabled:opacity-30 flex items-center justify-center gap-3 transition-all active:scale-95"
      >
        <Play className="size-5 fill-current" /> Iniciar fuga
      </button>

      <p className="text-[11px] text-muted-foreground/70 text-center mt-4 leading-relaxed">
        Entrada de 50 E$C debitada ao iniciar. Bater = perde tudo.
        Clicar em <span className="font-black">FUGIR</span> garante o saldo coletado.
      </p>
    </main>
  );
}

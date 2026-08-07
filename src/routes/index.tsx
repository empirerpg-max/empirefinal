import { createFileRoute } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  RefreshCw,
  TrendingUp,
  User,
  Plus,
  Radio,
  Music2,
  Music,
  PlayCircle,
  Disc,
  BarChart3,
  ListMusic,
} from "lucide-react";
import { toast } from "sonner";
import { useTelegramUser, haptic, openExternal } from "@/lib/telegram";
import { api, driveImg, fmtEC, type Artist, type RadarItem, invalidateCache, type ChartData } from "@/lib/api";

export const Route = createFileRoute("/")({
  component: Index,
});

type LoadState<T> = { status: "loading" } | { status: "error"; error: string } | { status: "ok"; data: T };

function Index() {
  const [myArtists, setMyArtists] = useState<LoadState<Artist[]>>({ status: "loading" });
  const [radarFeed, setRadarFeed] = useState<LoadState<RadarItem[]>>({ status: "loading" });
  const [topCharts, setTopCharts] = useState<Record<string, ChartData>>({});
  const [syncing, setSyncing] = useState(false);
  const { user, ready } = useTelegramUser();

  const fetchData = async (silent = false) => {
    if (!silent) setSyncing(true);

    const tasks: Promise<unknown>[] = [];

    if (user && user.id !== "guest") {
      setMyArtists({ status: "loading" });
      tasks.push(
        api
          .meusArtistas(user.id)
          .then((d) => setMyArtists({ status: "ok", data: d }))
          .catch((e) => setMyArtists({ status: "error", error: String(e?.message || e) }))
      );
    } else {
      setMyArtists({ status: "ok", data: [] });
    }

    setRadarFeed({ status: "loading" });
    tasks.push(
      api
        .radar()
        .then((d) => setRadarFeed({ status: "ok", data: d }))
        .catch((e) => setRadarFeed({ status: "error", error: String(e?.message || e) }))
    );

    tasks.push(api.topCharts().then(setTopCharts).catch(() => {}));

    await Promise.allSettled(tasks);
    if (!silent) setSyncing(false);
  };

  useEffect(() => {
    if (!ready) return;
    fetchData(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, user]);

  const handleSync = async () => {
    if (syncing) return;
    haptic.medium();
    invalidateCache();
    await fetchData(false);
    haptic.success();
    toast.success("Empire Sincronizado", { description: "Dados imperiais atualizados." });
  };

  const openLinkModal = () => {
    haptic.light();
    (window as any).setShowLinkModal?.(true);
  };

  return (
    <div className="pb-24 px-4 pt-6 max-w-md mx-auto min-h-screen">
      {/* Header */}
      <header className="flex items-center justify-between mb-6 animate-in fade-in duration-500">
        <div>
          <h1 className="text-2xl font-black italic tracking-tighter uppercase leading-none mb-1">
            Empire <span className="text-primary">Hub</span>
          </h1>
          <p className="text-[11px] uppercase font-bold text-muted-foreground tracking-[0.15em]">
            Plataforma de Gestão Imperial
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleSync}
            disabled={syncing}
            aria-label={syncing ? "Sincronizando" : "Sincronizar dados"}
            aria-busy={syncing}
            className="size-11 rounded-full bg-white/5 border border-white/10 grid place-items-center active:scale-90 transition-transform hover:bg-primary/10 hover:text-primary disabled:opacity-60"
          >
            <RefreshCw className={`size-4 ${syncing ? "animate-spin" : ""}`} aria-hidden="true" />
          </button>
          <div className="size-11 rounded-full bg-primary/20 border border-primary/30 grid place-items-center overflow-hidden">
            {user?.photo_url ? (
              <img
                src={user.photo_url}
                className="size-11 rounded-full object-cover"
                alt={user?.name ? `Foto de ${user.name}` : "Foto do usuário"}
                loading="lazy"
                decoding="async"
              />
            ) : (
              <User className="size-5 text-primary" aria-hidden="true" />
            )}
          </div>
        </div>
      </header>

      {/* MEUS ARTISTAS */}
      <section className="mb-10" aria-labelledby="meus-artistas-h">
        <div className="flex items-center justify-between mb-4">
          <h2 id="meus-artistas-h" className="text-xs font-black uppercase tracking-[0.2em] flex items-center gap-2">
            <span className="size-2 rounded-full bg-primary animate-pulse" aria-hidden="true" />
            Meus Artistas
          </h2>
          <Link
            to="/artistas"
            search={{ filter: "mine" }}
            onClick={() => haptic.selection()}
            className="text-[11px] font-bold uppercase text-primary tracking-wider hover:underline min-h-11 grid place-items-center"
          >
            Ver tudo
          </Link>
        </div>

        {myArtists.status === "loading" ? (
          <div className="flex gap-3 overflow-x-hidden">
            {[1, 2, 3].map((i) => (
              <div key={i} className="min-w-[110px] h-[7.5rem] rounded-[1.5rem] bg-white/5 animate-pulse" />
            ))}
          </div>
        ) : myArtists.status === "error" ? (
          <div className="p-5 rounded-[1.5rem] bg-destructive/10 border border-destructive/20 text-center">
            <p className="text-xs font-bold text-destructive mb-2">Não conseguimos carregar seus artistas</p>
            <button
              onClick={() => fetchData(false)}
              className="text-[11px] font-black uppercase tracking-wider text-primary underline min-h-11"
            >
              Tentar novamente
            </button>
          </div>
        ) : myArtists.data.length === 0 ? (
          <button
            type="button"
            onClick={openLinkModal}
            className="w-full p-6 rounded-[1.75rem] bg-card/50 border-2 border-dashed border-primary/20 flex flex-col items-center justify-center text-center hover:bg-primary/5 transition-all group min-h-32"
          >
            <div className="size-12 rounded-2xl bg-primary/10 grid place-items-center mb-3 group-hover:scale-110 transition-transform">
              <Plus className="size-6 text-primary" aria-hidden="true" />
            </div>
            <p className="text-sm font-black uppercase tracking-tight mb-1">Vincule seu primeiro artista</p>
            <p className="text-[11px] font-medium text-muted-foreground leading-snug max-w-[18rem]">
              Conecte uma lenda livre ao seu império para acompanhar saldo, projetos e charts.
            </p>
          </button>
        ) : (
          <div className="flex gap-3 overflow-x-auto pb-4 scrollbar-hide -mx-4 px-4 snap-x">
            {myArtists.data.map((a) => (
              <Link
                key={a.nome}
                to="/artistas/$nome"
                params={{ nome: a.nome }}
                onClick={() => haptic.selection()}
                className="min-w-[120px] snap-center p-2.5 rounded-[1.5rem] bg-white/5 backdrop-blur-md border border-white/10 flex flex-col items-center gap-2 active:scale-95 transition-all group"
              >
                <div className="size-16 rounded-2xl bg-secondary overflow-hidden flex-shrink-0 border border-white/10 shadow-lg group-hover:scale-105 transition-transform">
                  <img
                    src={driveImg(a.foto, 150)}
                    className="w-full h-full object-cover"
                    alt={`Foto de ${a.nome}`}
                    loading="lazy"
                    decoding="async"
                  />
                </div>
                <div className="text-center w-full px-1 overflow-hidden">
                  <h3 className="text-[12px] font-black uppercase truncate leading-tight group-hover:text-primary transition-colors">
                    {a.nome}
                  </h3>
                  <p className="text-[11px] font-bold text-primary/80 mt-0.5 whitespace-nowrap overflow-hidden">
                    {fmtEC(a.saldo)}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* BILLBOARD HOT 100 */}
      {(() => {
        const data = topCharts.billboard_hot_100;
        const finalUrl = data?.url || "https://empirerpg-max.github.io/central/charts.html?tab=BILLBOARD%20HOT%20100";

        return (
          <section className="mb-12" aria-labelledby="billboard-h">
            <div className="flex items-center justify-between mb-4">
              <h2 id="billboard-h" className="text-xs font-black uppercase tracking-[0.2em]">
                Billboard Hot 100 #1
              </h2>
            </div>
            <button
              type="button"
              onClick={() => {
                haptic.light();
                openExternal(finalUrl);
              }}
              className="group relative block w-full aspect-[16/10] rounded-[2rem] overflow-hidden border border-white/10 shadow-2xl bg-white/5 text-left"
            >
              {data?.foto ? (
                <img
                  src={driveImg(data.foto, 800)}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
                  alt={data.musica ? `Capa: ${data.musica}` : "Billboard Hot 100"}
                  loading="lazy"
                  decoding="async"
                />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center gap-4 opacity-20">
                  <TrendingUp className="size-20" aria-hidden="true" />
                  <span className="text-xs font-black uppercase tracking-[0.3em]">Global Chart</span>
                </div>
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-black via-black/30 to-transparent" />

              <div className="absolute inset-x-4 bottom-4 p-4 rounded-[1.5rem] bg-white/10 backdrop-blur-xl border border-white/20 shadow-2xl">
                <div className="flex items-center gap-3">
                  <div className="size-12 rounded-full bg-primary grid place-items-center flex-shrink-0">
                    <TrendingUp className="size-6 text-black" aria-hidden="true" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-white text-sm font-black uppercase tracking-tight leading-tight mb-0.5 line-clamp-1">
                      {data?.musica || "Ver Billboard Hot 100"}
                    </h3>
                    <p className="text-primary text-[11px] font-bold uppercase tracking-wider truncate">
                      {data?.artista || "Dados semanais"}
                    </p>
                  </div>
                </div>
              </div>

              <div className="absolute top-4 right-4">
                <span className="px-3 py-1.5 rounded-full bg-primary text-black text-[10px] font-black uppercase tracking-wider shadow-lg">
                  This week
                </span>
              </div>
            </button>
          </section>
        );
      })()}

      {/* PLATFORM CHARTS */}
      <section className="mb-12" aria-labelledby="platforms-h">
        <h2 id="platforms-h" className="text-xs font-black uppercase tracking-[0.2em] mb-4 text-muted-foreground">
          Top por plataforma
        </h2>
        <div className="flex gap-3 overflow-x-auto pb-4 scrollbar-hide -mx-4 px-4 snap-x">
          {[
            { id: "spotify", label: "Spotify", icon: Music2, color: "text-[#1DB954]", link: "https://empirerpg-max.github.io/central/charts.html?tab=SPOTIFY" },
            { id: "apple_music", label: "Apple Music", icon: Music, color: "text-[#FC3C44]", link: "https://empirerpg-max.github.io/central/charts.html?tab=APPLE%20MUSIC" },
            { id: "youtube", label: "YouTube", icon: PlayCircle, color: "text-[#FF0000]", link: "https://empirerpg-max.github.io/central/charts.html?tab=YOUTUBE" },
            { id: "billboard_200", label: "Billboard 200", icon: Disc, color: "text-primary", link: "https://empirerpg-max.github.io/central/charts.html?tab=DADOS%20%C3%81LBUNS" },
            { id: "digital_sales", label: "Digital Sales", icon: BarChart3, color: "text-blue-500", link: "https://empirerpg-max.github.io/central/charts.html?tab=DIGITAL%20SALES" },
          ].map((plat) => {
            const data = topCharts[plat.id];
            const finalUrl = data?.url || plat.link;
            const Icon = plat.icon;
            return (
              <button
                type="button"
                key={plat.id}
                onClick={() => {
                  haptic.light();
                  openExternal(finalUrl);
                }}
                aria-label={`Abrir parada ${plat.label}`}
                className="min-w-[160px] snap-center group relative overflow-hidden rounded-[1.75rem] border border-white/10 bg-white/5 backdrop-blur-md active:scale-95 transition-all shadow-xl text-left"
              >
                <div className="aspect-square overflow-hidden relative">
                  {data?.foto ? (
                    <img
                      src={driveImg(data.foto, 400)}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                      alt={`${plat.label} #1`}
                      loading="lazy"
                      decoding="async"
                    />
                  ) : (
                    <div className="w-full h-full bg-secondary flex flex-col items-center justify-center p-4">
                      <Icon className={`size-12 ${plat.color} opacity-30 mb-2`} aria-hidden="true" />
                      <span className="text-[11px] font-bold uppercase opacity-50 text-center">Abrir parada</span>
                    </div>
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black via-black/20 to-transparent" />
                  <div className="absolute top-3 left-3 size-9 rounded-full bg-black/60 backdrop-blur-md grid place-items-center border border-white/10">
                    <Icon className={`size-5 ${plat.color}`} aria-hidden="true" />
                  </div>
                </div>
                <div className="p-3.5">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-primary mb-1 block">{plat.label}</span>
                  <h4 className="text-[13px] font-black uppercase leading-tight line-clamp-1">
                    {data?.musica || "Ver parada"}
                  </h4>
                  <p className="text-[11px] text-muted-foreground font-medium truncate mt-0.5">
                    {data?.artista || "Toque para abrir"}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* EMPIRE PLAYLISTS */}
      <section className="mb-12" aria-labelledby="playlists-h">
        <div className="flex items-center justify-between mb-4">
          <h2 id="playlists-h" className="text-xs font-black uppercase tracking-[0.2em] flex items-center gap-2">
            <ListMusic className="size-4 text-primary" aria-hidden="true" />
            Empire Playlists
          </h2>
          <Link
            to="/playlists"
            onClick={() => haptic.selection()}
            className="text-[11px] font-bold uppercase text-primary tracking-wider hover:underline min-h-11 grid place-items-center"
          >
            Explorar
          </Link>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => { haptic.light(); openExternal("https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M"); }}
            className="group relative h-32 rounded-[1.75rem] overflow-hidden border border-white/5 bg-[#1DB954]/10 transition-all hover:border-[#1DB954]/40 text-left"
          >
            <div className="absolute inset-0 bg-gradient-to-br from-[#1DB954]/20 to-transparent" />
            <div className="relative p-4 h-full flex flex-col justify-between">
              <Music2 className="size-7 text-[#1DB954]" aria-hidden="true" />
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-[#1DB954]">Spotify</p>
                <h3 className="text-sm font-black uppercase tracking-tight leading-tight">Elite Hits</h3>
              </div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => { haptic.light(); openExternal("https://music.apple.com/us/playlist/todays-hits/pl.f4d1e2e1"); }}
            className="group relative h-32 rounded-[1.75rem] overflow-hidden border border-white/5 bg-[#FC3C44]/10 transition-all hover:border-[#FC3C44]/40 text-left"
          >
            <div className="absolute inset-0 bg-gradient-to-br from-[#FC3C44]/20 to-transparent" />
            <div className="relative p-4 h-full flex flex-col justify-between">
              <Music className="size-7 text-[#FC3C44]" aria-hidden="true" />
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-[#FC3C44]">Apple Music</p>
                <h3 className="text-sm font-black uppercase tracking-tight leading-tight">Chart Top 50</h3>
              </div>
            </div>
          </button>
        </div>
      </section>

      {/* RADAR FEED */}
      <section aria-labelledby="radar-h">
        <div className="flex items-center justify-between mb-4">
          <h2 id="radar-h" className="text-xs font-black uppercase tracking-[0.2em] flex items-center gap-2">
            <Radio className="size-4 text-red-500 animate-pulse" aria-hidden="true" />
            Radar Feed
          </h2>
          <span className="text-[11px] font-bold uppercase text-muted-foreground">Ao vivo</span>
        </div>

        <div className="space-y-3">
          {radarFeed.status === "loading" ? (
            [1, 2, 3].map((i) => <div key={i} className="h-20 rounded-[1.5rem] bg-white/5 animate-pulse" />)
          ) : radarFeed.status === "error" ? (
            <div className="p-5 rounded-[1.5rem] bg-destructive/10 border border-destructive/20 text-center">
              <p className="text-xs font-bold text-destructive mb-2">Radar indisponível</p>
              <button
                onClick={() => fetchData(false)}
                className="text-[11px] font-black uppercase tracking-wider text-primary underline min-h-11"
              >
                Tentar novamente
              </button>
            </div>
          ) : radarFeed.data.length === 0 ? (
            <div className="p-8 text-center text-xs uppercase font-bold text-muted-foreground">
              Silêncio no radar — nada por aqui ainda.
            </div>
          ) : (
            radarFeed.data.map((item, idx) => (
              <article
                key={idx}
                className="flex items-center gap-3 p-4 rounded-[1.5rem] bg-card/40 border border-white/5 hover:bg-white/5 transition-colors group"
              >
                <div className="size-12 rounded-2xl bg-secondary flex-shrink-0 overflow-hidden border border-white/10">
                  <img
                    src={driveImg(item.foto, 150)}
                    className="w-full h-full object-cover"
                    alt={item.nome ? `Foto de ${item.nome}` : "Radar"}
                    loading="lazy"
                    decoding="async"
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <h3 className="text-sm font-black uppercase truncate group-hover:text-primary transition-colors">
                      {item.nome}
                    </h3>
                    <span className="text-[10px] font-bold text-primary/70 flex-shrink-0 uppercase tracking-wider">
                      Live
                    </span>
                  </div>
                  <p className="text-[12px] text-muted-foreground font-medium line-clamp-1 mt-0.5">
                    {item.acao}
                  </p>
                </div>
              </article>
            ))
          )}
        </div>
      </section>

      <footer className="mt-12 text-center pb-6 border-t border-white/5 pt-6">
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground/40">
          Empire Hub • Est. 2026
        </p>
      </footer>
    </div>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import {
  RefreshCw,
  TrendingUp,
  User,
  Music2,
  Music,
  PlayCircle,
  Disc,
  BarChart3,
  Instagram,
  Twitter,
  Video,
  Quote,
} from "lucide-react";
import { toast } from "sonner";
import { useTelegramUser, haptic, openExternal } from "@/lib/telegram";
import { api, driveImg, invalidateCache, type ChartData } from "@/lib/api";
import { useHomeConfig } from "@/lib/homeFlags";
import { getStoredLogin } from "@/components/LoginScreen";

export const Route = createFileRoute("/")({
  component: Index,
});

type LoadState<T> = { status: "loading" } | { status: "error"; error: string } | { status: "ok"; data: T };

interface LancamentoRecente {
  id: string;
  titulo: string;
  artista: string;
  coverUrl: string | null;
  dataIso: string;
}

interface SocialPostResumo {
  id: string;
  tipo: string;
  autor: string;
  handle?: string;
  avatar?: string;
  texto: string;
  media_url?: string;
  data: string;
}

const PLATFORM_META: Record<string, { label: string; icon: typeof Music2; color: string }> = {
  spotify: { label: "Spotify", icon: Music2, color: "text-[#1DB954]" },
  apple_music: { label: "Apple Music", icon: Music, color: "text-[#FC3C44]" },
  youtube: { label: "YouTube", icon: PlayCircle, color: "text-[#FF0000]" },
  billboard_200: { label: "Billboard 200", icon: Disc, color: "text-primary" },
  digital_sales: { label: "Digital Sales", icon: BarChart3, color: "text-blue-500" },
};

function Index() {
  const [topCharts, setTopCharts] = useState<Record<string, ChartData>>({});
  const [lancamentosRecentes, setLancamentosRecentes] = useState<LoadState<LancamentoRecente[]>>({
    status: "loading",
  });
  const [ultimasPostagens, setUltimasPostagens] = useState<LoadState<SocialPostResumo[]>>({
    status: "loading",
  });
  const [syncing, setSyncing] = useState(false);
  const { user, ready } = useTelegramUser();
  const config = useHomeConfig();
  const login = getStoredLogin();
  const fotoUsuario = login?.fotoPerfil || user?.photo_url || "";
  const nomeUsuario = login?.nome || user?.name || "Visitante";

  const fetchData = async (silent = false) => {
    if (!silent) setSyncing(true);

    const tasks: Promise<unknown>[] = [];

    tasks.push(api.topCharts().then(setTopCharts).catch(() => {}));

    tasks.push(
      fetch("/api/empire-play/lancamentos-recentes")
        .then((res) => (res.ok ? res.json() : null))
        .then((json) => {
          if (json?.success && Array.isArray(json.data)) {
            setLancamentosRecentes({ status: "ok", data: json.data });
          } else {
            setLancamentosRecentes({ status: "error", error: "Falha ao carregar" });
          }
        })
        .catch((e) => setLancamentosRecentes({ status: "error", error: String(e?.message || e) })),
    );

    tasks.push(
      (api as any)
        .listarPostsSocial()
        .then((data: SocialPostResumo[]) => {
          if (!Array.isArray(data)) throw new Error("Formato inválido");
          const ordenado = [...data].sort(
            (a, b) => new Date(b.data).getTime() - new Date(a.data).getTime(),
          );
          setUltimasPostagens({ status: "ok", data: ordenado.slice(0, 6) });
        })
        .catch((e: any) => setUltimasPostagens({ status: "error", error: String(e?.message || e) })),
    );

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

  const sections: Record<string, () => ReactNode> = {
    meusArtistas: () => (
      <section className="mb-10" aria-labelledby="ultimas-postagens-h">
        <div className="flex items-center justify-between mb-4">
          <h2
            id="ultimas-postagens-h"
            className="text-xs font-black uppercase tracking-[0.2em] flex items-center gap-2"
          >
            <span className="size-2 rounded-full bg-primary animate-pulse" aria-hidden="true" />
            Últimas Publicações
          </h2>
          <Link
            to="/social"
            onClick={() => haptic.selection()}
            className="text-[11px] font-bold uppercase text-primary tracking-wider hover:underline min-h-11 grid place-items-center"
          >
            Ver tudo
          </Link>
        </div>

        {ultimasPostagens.status === "loading" ? (
          <div className="flex gap-3 overflow-x-hidden">
            {[1, 2, 3].map((i) => (
              <div key={i} className="min-w-[150px] h-[10rem] rounded-[1.5rem] bg-white/5 animate-pulse" />
            ))}
          </div>
        ) : ultimasPostagens.status === "error" ? (
          <div className="p-5 rounded-[1.5rem] bg-destructive/10 border border-destructive/20 text-center">
            <p className="text-xs font-bold text-destructive mb-2">Não conseguimos carregar as publicações</p>
            <button
              onClick={() => fetchData(false)}
              className="text-[11px] font-black uppercase tracking-wider text-primary underline min-h-11"
            >
              Tentar novamente
            </button>
          </div>
        ) : ultimasPostagens.data.length === 0 ? (
          <div className="w-full p-6 rounded-[1.75rem] bg-card/50 border-2 border-dashed border-primary/20 flex flex-col items-center justify-center text-center min-h-32">
            <p className="text-sm font-black uppercase tracking-tight mb-1">Nenhuma publicação ainda</p>
            <p className="text-[11px] font-medium text-muted-foreground leading-snug max-w-[18rem]">
              Poste como um dos seus artistas no Social pra aparecer aqui.
            </p>
          </div>
        ) : (
          <div className="flex gap-3 overflow-x-auto pb-4 scrollbar-hide -mx-4 px-4 snap-x">
            {ultimasPostagens.data.map((p) => {
              const PlatformIcon = p.tipo === "Instagram" ? Instagram : p.tipo === "TikTok" ? Video : Twitter;
              return p.media_url ? (
                <Link
                  key={p.id}
                  to="/social"
                  search={{ postId: p.id }}
                  onClick={() => haptic.selection()}
                  className="min-w-[150px] snap-center rounded-[1.5rem] overflow-hidden bg-white/5 border border-white/10 active:scale-95 transition-all flex flex-col"
                >
                  <div className="aspect-square bg-secondary overflow-hidden">
                    <img
                      src={driveImg(p.media_url, 300)}
                      className="w-full h-full object-cover"
                      alt={p.autor}
                      loading="lazy"
                      decoding="async"
                      referrerPolicy="no-referrer"
                    />
                  </div>
                  <div className="p-2.5">
                    <h3 className="text-[11px] font-black uppercase leading-tight line-clamp-1">{p.autor}</h3>
                    <p className="text-[10px] text-muted-foreground font-bold truncate mt-0.5">{p.tipo}</p>
                  </div>
                </Link>
              ) : (
                <Link
                  key={p.id}
                  to="/social"
                  search={{ postId: p.id }}
                  onClick={() => haptic.selection()}
                  className="min-w-[220px] max-w-[220px] snap-center rounded-[1.5rem] bg-white/5 border border-white/10 active:scale-95 transition-all flex flex-col p-3.5"
                >
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-[11px] font-black uppercase leading-tight line-clamp-1">{p.autor}</h3>
                    <PlatformIcon className="size-3.5 text-muted-foreground shrink-0" aria-hidden="true" />
                  </div>
                  <div className="flex-1 flex items-start gap-1.5">
                    <Quote className="size-3 text-primary/50 shrink-0 mt-0.5" aria-hidden="true" />
                    <p className="text-[12px] font-medium leading-snug line-clamp-4">{p.texto}</p>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>
    ),

    billboard: () => {
      const data = topCharts.billboard_hot_100;
      const finalUrl = data?.url || config.sections.billboard.fallbackUrl;

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
                referrerPolicy="no-referrer"
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
    },

    topPlataformas: () => (
      <section className="mb-12" aria-labelledby="platforms-h">
        <h2 id="platforms-h" className="text-xs font-black uppercase tracking-[0.2em] mb-4 text-muted-foreground">
          Top por plataforma
        </h2>
        <div className="flex gap-3 overflow-x-auto pb-4 scrollbar-hide -mx-4 px-4 snap-x">
          {Object.entries(config.sections.topPlataformas.links).map(([id, link]) => {
            const meta = PLATFORM_META[id];
            if (!meta) return null;
            const data = topCharts[id];
            const finalUrl = data?.url || link;
            const Icon = meta.icon;
            return (
              <button
                type="button"
                key={id}
                onClick={() => {
                  haptic.light();
                  openExternal(finalUrl);
                }}
                aria-label={`Abrir parada ${meta.label}`}
                className="min-w-[160px] snap-center group relative overflow-hidden rounded-[1.75rem] border border-white/10 bg-white/5 backdrop-blur-md active:scale-95 transition-all shadow-xl text-left"
              >
                <div className="aspect-square overflow-hidden relative">
                  {data?.foto ? (
                    <img
                      src={driveImg(data.foto, 400)}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                      alt={`${meta.label} #1`}
                      loading="lazy"
                      decoding="async"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div className="w-full h-full bg-secondary flex flex-col items-center justify-center p-4">
                      <Icon className={`size-12 ${meta.color} opacity-30 mb-2`} aria-hidden="true" />
                      <span className="text-[11px] font-bold uppercase opacity-50 text-center">Abrir parada</span>
                    </div>
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black via-black/20 to-transparent" />
                  <div className="absolute top-3 left-3 size-9 rounded-full bg-black/60 backdrop-blur-md grid place-items-center border border-white/10">
                    <Icon className={`size-5 ${meta.color}`} aria-hidden="true" />
                  </div>
                </div>
                <div className="p-3.5">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-primary mb-1 block">{meta.label}</span>
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
    ),
  };

  const isEnabled = (key: string) =>
    key in config.sections && (config.sections as Record<string, { enabled: boolean }>)[key].enabled;

  return (
    <div className="pb-24 px-4 pt-6 max-w-md mx-auto min-h-screen">
      {/* Header */}
      <header className="flex items-center justify-between mb-6 animate-in fade-in duration-500">
        <div className="flex items-center gap-3 min-w-0">
          <div className="size-12 shrink-0 rounded-full bg-primary/20 border border-primary/30 grid place-items-center overflow-hidden">
            {fotoUsuario ? (
              <img
                src={driveImg(fotoUsuario, 100)}
                className="size-12 rounded-full object-cover"
                alt={`Foto de ${nomeUsuario}`}
                referrerPolicy="no-referrer"
                loading="lazy"
                decoding="async"
              />
            ) : (
              <User className="size-5 text-primary" aria-hidden="true" />
            )}
          </div>
          <div className="min-w-0">
            <p className="text-base font-black leading-none truncate">
              Olá, {nomeUsuario}
            </p>
            <p className="text-[11px] uppercase font-bold text-muted-foreground tracking-[0.15em] mt-1">
              Empire <span className="text-primary">Hub</span>
            </p>
          </div>
        </div>
        <button
          onClick={handleSync}
          disabled={syncing}
          aria-label={syncing ? "Sincronizando" : "Sincronizar dados"}
          aria-busy={syncing}
          className="size-11 shrink-0 rounded-full bg-white/5 border border-white/10 grid place-items-center active:scale-90 transition-transform hover:bg-primary/10 hover:text-primary disabled:opacity-60"
        >
          <RefreshCw className={`size-4 ${syncing ? "animate-spin" : ""}`} aria-hidden="true" />
        </button>
      </header>

      <section className="mb-10" aria-labelledby="lancamentos-recentes-h">
        <h2
          id="lancamentos-recentes-h"
          className="text-xs font-black uppercase tracking-[0.2em] mb-4"
        >
          Lançamentos Recentes
        </h2>

        {lancamentosRecentes.status === "loading" ? (
          <div className="flex gap-3 overflow-x-hidden">
            {[1, 2, 3].map((i) => (
              <div key={i} className="min-w-[140px] h-[10.5rem] rounded-[1.5rem] bg-white/5 animate-pulse" />
            ))}
          </div>
        ) : lancamentosRecentes.status === "ok" && lancamentosRecentes.data.length > 0 ? (
          <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide -mx-4 px-4 snap-x">
            {lancamentosRecentes.data.map((l) => (
              <Link
                key={l.id}
                to="/empire-play/forum"
                search={{ tab: "musicas", id: l.id }}
                onClick={() => haptic.selection()}
                className="min-w-[140px] snap-center rounded-[1.5rem] overflow-hidden bg-white/5 border border-white/10 active:scale-95 transition-all"
              >
                <div className="aspect-square bg-secondary overflow-hidden">
                  {l.coverUrl ? (
                    <img
                      src={driveImg(l.coverUrl, 300)}
                      className="w-full h-full object-cover"
                      alt={l.titulo}
                      loading="lazy"
                      decoding="async"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div className="w-full h-full grid place-items-center opacity-20">
                      <Music className="size-8" aria-hidden="true" />
                    </div>
                  )}
                </div>
                <div className="p-2.5">
                  <h3 className="text-[11px] font-black uppercase leading-tight line-clamp-1">
                    {l.titulo}
                  </h3>
                  <p className="text-[10px] text-muted-foreground font-bold truncate mt-0.5">
                    {l.artista}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground/60 font-medium">
            Nenhum lançamento recente encontrado nos charts.
          </p>
        )}
      </section>

      {config.order.map((key) =>
        isEnabled(key) && sections[key] ? <div key={key}>{sections[key]()}</div> : null
      )}

      <footer className="mt-12 text-center pb-6 border-t border-white/5 pt-6">
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground/40">
          Empire Hub • Est. 2026
        </p>
      </footer>
    </div>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import {
  Trophy,
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
  Calendar,
  Clock,
  Tv,
  Newspaper,
  BookOpen,
  MessageSquareText,
} from "lucide-react";
import { toast } from "sonner";
import { useTelegramUser, haptic } from "@/lib/telegram";
import { api, driveImg, type ChartData, type NivelJogador } from "@/lib/api";
import { useHomeConfig } from "@/lib/homeFlags";
import { getStoredLogin } from "@/components/LoginScreen";
import { LoadErrorState } from "@/components/LoadErrorState";
import { ActivityTicker } from "@/components/ActivityTicker";

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

interface ProximoEvento {
  id: string;
  tipo: "show" | "tv";
  titulo: string;
  subtitulo: string;
  data: string; // dd/mm/yyyy
  horario?: string; // HH:MM, só quando existe (TV)
  timestamp: number; // pra ordenar
  linkTo: string;
  linkParams?: Record<string, string>;
  linkSearch?: Record<string, string>;
}

interface SocialPostResumo {
  id: string;
  tipo: string;
  subtipo?: string;
  autor: string;
  handle?: string;
  avatar?: string;
  texto: string;
  media_url?: string;
  data: string;
}

interface AcervoItem {
  id: string;
  tipo: "revista" | "entrevista";
  titulo: string;
  artista: string;
  capa?: string;
  data: string;
}

// chartsTab = aba correspondente em /charts (CategoryId) — os cards da home
// abrem a parada específica dentro do app, em vez de sair pro site externo.
const PLATFORM_META: Record<
  string,
  { label: string; icon: typeof Music2; color: string; chartsTab: "spotify" | "apple" | "youtube" | "albums" | "sales" }
> = {
  spotify: { label: "Spotify", icon: Music2, color: "text-[#1DB954]", chartsTab: "spotify" },
  apple_music: { label: "Apple Music", icon: Music, color: "text-[#FC3C44]", chartsTab: "apple" },
  youtube: { label: "YouTube", icon: PlayCircle, color: "text-[#FF0000]", chartsTab: "youtube" },
  billboard_200: { label: "Billboard 200", icon: Disc, color: "text-primary", chartsTab: "albums" },
  digital_sales: { label: "Digital Sales", icon: BarChart3, color: "text-blue-500", chartsTab: "sales" },
};

function Index() {
  const [topCharts, setTopCharts] = useState<Record<string, ChartData>>({});
  const [lancamentosRecentes, setLancamentosRecentes] = useState<LoadState<LancamentoRecente[]>>({
    status: "loading",
  });
  const [ultimasPostagens, setUltimasPostagens] = useState<LoadState<SocialPostResumo[]>>({
    status: "loading",
  });
  const [acervoRecente, setAcervoRecente] = useState<LoadState<AcervoItem[]>>({
    status: "loading",
  });
  const [proximosEventos, setProximosEventos] = useState<LoadState<ProximoEvento[]>>({
    status: "loading",
  });
  const [syncing, setSyncing] = useState(false);
  const { user, ready } = useTelegramUser();
  const config = useHomeConfig();
  const login = getStoredLogin();
  const fotoUsuario = login?.fotoPerfil || user?.photo_url || "";
  const nomeUsuario = login?.nome || user?.name || "Visitante";

  // Prestígio/nível do jogador logado — mostrado no lugar do antigo botão de
  // recarregar do cabeçalho (redundante com o botão fixo na barra do topo,
  // ver __root.tsx).
  const [meuNivel, setMeuNivel] = useState<NivelJogador | null>(null);
  useEffect(() => {
    const usuario = login?.usuario;
    const telegramId = user?.id && user.id !== "guest" ? user.id : undefined;
    if (!usuario && !telegramId) return;
    api.meuNivel({ usuario, telegramId }).then(setMeuNivel).catch(() => setMeuNivel(null));
  }, [login?.usuario, user?.id]);

  // dd/mm/yyyy [+ HH:MM opcional] → timestamp, pra ordenar shows (só data) e
  // programas de TV (data+horário) juntos na mesma lista.
  function parseDataHorarioBR(data: string, horario?: string): number {
    const m = data.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!m) return Number.MAX_SAFE_INTEGER;
    const [, dd, mm, yyyy] = m;
    const h = horario?.match(/^(\d{1,2}):(\d{2})$/);
    const hh = h ? Number(h[1]) : 0;
    const min = h ? Number(h[2]) : 0;
    return new Date(Number(yyyy), Number(mm) - 1, Number(dd), hh, min).getTime();
  }

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

    // "Últimas Publicações" mistura posts do Social com matérias de News —
    // os dois têm o mesmo formato (autor, texto curto, imagem opcional) e
    // já vivem dentro do módulo Social, então cabem no mesmo carrossel.
    // Revistas/Entrevistas ficam de fora (seção própria, ver abaixo) —
    // conteúdo mais denso (capa, múltiplas páginas, pergunta-e-resposta),
    // não cabe no mesmo card pequeno.
    tasks.push(
      Promise.all([
        (api as any).listarPostsSocial().catch(() => []),
        (api as any).listarNewsSocial().catch(() => []),
      ])
        .then(([posts, news]: [SocialPostResumo[], any[]]) => {
          // Stories não são post permanente — não entram em "Últimas
          // Publicações" (só vivem na fileira de destaques da Social).
          const postsArr = (Array.isArray(posts) ? posts : []).filter(
            (p: SocialPostResumo) => !(p.tipo === "Instagram" && p.subtipo === "Story"),
          );
          const newsArr = Array.isArray(news) ? news : [];
          const newsComoPost: SocialPostResumo[] = newsArr.map((n) => ({
            id: n.id,
            tipo: "News",
            autor: n.autor,
            texto: n.titulo,
            media_url: n.imagem || undefined,
            data: n.data,
          }));
          const ordenado = [...postsArr, ...newsComoPost].sort(
            (a, b) => new Date(b.data).getTime() - new Date(a.data).getTime(),
          );
          // Mesmo artista aparecendo em sequência (postou várias vezes
          // seguidas) só entra com a publicação mais recente dele — abre
          // espaço pra outros artistas aparecerem em vez de lotar o
          // carrossel inteiro com uma pessoa só.
          const semRepeticaoSucessiva = ordenado.filter(
            (item, i) => i === 0 || item.autor !== ordenado[i - 1].autor,
          );
          setUltimasPostagens({ status: "ok", data: semRepeticaoSucessiva.slice(0, 8) });
        })
        .catch((e: any) => setUltimasPostagens({ status: "error", error: String(e?.message || e) })),
    );

    tasks.push(
      Promise.all([
        api.listarRevistasAcervo().catch(() => []),
        api.listarEntrevistasAcervo().catch(() => []),
      ])
        .then(([revistas, entrevistas]) => {
          const revistasArr = (Array.isArray(revistas) ? revistas : []).map((r: any) => ({
            id: r.id,
            tipo: "revista" as const,
            titulo: r.titulo,
            artista: r.artista,
            capa: r.capa,
            data: r.data,
          }));
          const entrevistasArr = (Array.isArray(entrevistas) ? entrevistas : []).map((e: any) => ({
            id: e.id,
            tipo: "entrevista" as const,
            titulo: e.titulo,
            artista: e.artista,
            capa: e.capa,
            data: e.data,
          }));
          const ordenado = [...revistasArr, ...entrevistasArr].sort(
            (a, b) => new Date(b.data).getTime() - new Date(a.data).getTime(),
          );
          setAcervoRecente({ status: "ok", data: ordenado.slice(0, 8) });
        })
        .catch((e: any) => setAcervoRecente({ status: "error", error: String(e?.message || e) })),
    );

    // Próximos Eventos mistura os shows de turnê de TODOS os jogadores (não
    // só os meus) com a programação do Empire TV — é pra estimular a galera
    // a acompanhar/comentar a turnê uns dos outros, igual já rola na Central
    // de Notícias dentro do menu Tour. Por isso não depende de login.
    tasks.push(
      Promise.all([
        fetch("/api/turnes/proximas-globais")
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
        fetch("/api/tv/programas")
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
      ])
        .then(([missoesRes, tvRes]) => {
          const missoes = missoesRes?.success && Array.isArray(missoesRes.data) ? missoesRes.data : [];
          const showEventos: (ProximoEvento & { _artista: string })[] = missoes
            .map((m: any) => ({
              id: `show-${m.idUnico}-${m.showNumero}`,
              tipo: "show" as const,
              titulo: `${m.artista} — Show #${m.showNumero}`,
              subtitulo: `${m.local}, ${m.cidade}`,
              data: m.data,
              timestamp: parseDataHorarioBR(m.data),
              linkTo: "/tours/$nome",
              linkParams: { nome: m.artista },
              linkSearch: { id: m.idUnico },
              _artista: m.artista as string,
            }))
            .sort((a: ProximoEvento, b: ProximoEvento) => a.timestamp - b.timestamp);

          // Prioridade pedida: se só tem 1 artista em turnê, mostra até 3
          // shows dele. Com mais de 1 artista, intercala 1 por artista (o
          // mais próximo de cada), até no máximo 5 — senão fica poluído.
          const artistasEmTurne = [...new Set(showEventos.map((e) => e._artista))];
          let tourEventos: ProximoEvento[];
          if (artistasEmTurne.length <= 1) {
            tourEventos = showEventos.slice(0, 3);
          } else {
            const porArtista = new Map<string, ProximoEvento[]>();
            for (const ev of showEventos) {
              if (!porArtista.has(ev._artista)) porArtista.set(ev._artista, []);
              porArtista.get(ev._artista)!.push(ev);
            }
            const intercalado: ProximoEvento[] = [];
            let rodada = 0;
            while (intercalado.length < 5) {
              let adicionouAlgum = false;
              for (const lista of porArtista.values()) {
                if (lista[rodada]) {
                  intercalado.push(lista[rodada]);
                  adicionouAlgum = true;
                  if (intercalado.length >= 5) break;
                }
              }
              if (!adicionouAlgum) break;
              rodada += 1;
            }
            tourEventos = intercalado.sort((a, b) => a.timestamp - b.timestamp);
          }

          const programas = tvRes?.success && Array.isArray(tvRes.data) ? tvRes.data : [];
          const tvEventosTodos: ProximoEvento[] = programas
            .filter((p: any) => !p.finalizado)
            .map((p: any) => ({
              id: `tv-${p.id}`,
              tipo: "tv" as const,
              titulo: p.titulo,
              subtitulo: p.categoria || "Empire TV",
              data: p.data,
              horario: p.horario,
              timestamp: parseDataHorarioBR(p.data, p.horario),
              linkTo: "/tv",
            }))
            .sort((a: ProximoEvento, b: ProximoEvento) => a.timestamp - b.timestamp);

          // 1 evento de TV normalmente; se não tem nenhuma turnê rolando,
          // mostra mais TV pra não deixar o card praticamente vazio.
          const tvEventos = tvEventosTodos.slice(0, tourEventos.length === 0 ? 5 : 1);

          const eventos = [...tourEventos, ...tvEventos]
            .map(({ _artista, ...ev }: any) => ev as ProximoEvento)
            .sort((a: ProximoEvento, b: ProximoEvento) => a.timestamp - b.timestamp);
          setProximosEventos({ status: "ok", data: eventos });
        })
        .catch((e: any) => setProximosEventos({ status: "error", error: String(e?.message || e) })),
    );

    await Promise.allSettled(tasks);
    if (!silent) setSyncing(false);
  };

  useEffect(() => {
    if (!ready) return;
    fetchData(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, user]);

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
          <LoadErrorState onRetry={() => fetchData(false)} />
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
              const isNews = p.tipo === "News";
              const PlatformIcon = isNews
                ? Newspaper
                : p.tipo === "Instagram"
                  ? Instagram
                  : p.tipo === "TikTok"
                    ? Video
                    : Twitter;
              return p.media_url ? (
                <Link
                  key={p.id}
                  to="/social"
                  search={{ postId: p.id }}
                  onClick={() => haptic.selection()}
                  className="min-w-[150px] snap-center rounded-[1.5rem] overflow-hidden bg-white/5 border border-white/10 active:scale-95 transition-all flex flex-col"
                >
                  <div className="aspect-square bg-secondary overflow-hidden relative">
                    <img
                      src={driveImg(p.media_url, 300)}
                      className="w-full h-full object-cover"
                      alt={p.autor}
                      loading="lazy"
                      decoding="async"
                      referrerPolicy="no-referrer"
                    />
                    {isNews && (
                      <span className="absolute top-2 left-2 size-6 rounded-full bg-black/60 backdrop-blur-md grid place-items-center border border-white/10">
                        <Newspaper className="size-3 text-primary" aria-hidden="true" />
                      </span>
                    )}
                  </div>
                  <div className="p-2.5">
                    <h3 className="text-[11px] font-black uppercase leading-tight line-clamp-1">
                      {isNews ? p.texto : p.autor}
                    </h3>
                    <p className="text-[10px] text-muted-foreground font-bold truncate mt-0.5">
                      {isNews ? p.autor : p.tipo}
                    </p>
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

    acervoRecente: () => (
      <section className="mb-10" aria-labelledby="acervo-recente-h">
        <div className="flex items-center justify-between mb-4">
          <h2 id="acervo-recente-h" className="text-xs font-black uppercase tracking-[0.2em]">
            Revistas &amp; Entrevistas
          </h2>
          <Link
            to="/acervo"
            onClick={() => haptic.selection()}
            className="text-[11px] font-bold uppercase text-primary tracking-wider hover:underline min-h-11 grid place-items-center"
          >
            Ver tudo
          </Link>
        </div>

        {acervoRecente.status === "loading" ? (
          <div className="flex gap-2 overflow-x-hidden">
            {[1, 2, 3].map((i) => (
              <div key={i} className="min-w-[150px] h-12 rounded-xl bg-white/5 animate-pulse" />
            ))}
          </div>
        ) : acervoRecente.status === "error" ? (
          <LoadErrorState onRetry={() => fetchData(false)} />
        ) : acervoRecente.data.length === 0 ? (
          <div className="w-full p-6 rounded-[1.75rem] bg-card/50 border-2 border-dashed border-primary/20 flex flex-col items-center justify-center text-center min-h-32">
            <p className="text-sm font-black uppercase tracking-tight mb-1">Nada publicado ainda</p>
            <p className="text-[11px] font-medium text-muted-foreground leading-snug max-w-[18rem]">
              Publique uma revista ou entrevista no Acervo pra aparecer aqui.
            </p>
          </div>
        ) : (
          <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide -mx-4 px-4 snap-x">
            {acervoRecente.data.map((item) => {
              const TipoIcon = item.tipo === "revista" ? BookOpen : MessageSquareText;
              return (
                <Link
                  key={item.id}
                  to="/acervo"
                  onClick={() => haptic.selection()}
                  className="min-w-[150px] max-w-[150px] snap-center rounded-xl bg-white/5 border border-white/10 active:scale-95 transition-all flex items-center gap-2 p-2"
                >
                  <div className="size-8 shrink-0 rounded-md bg-secondary overflow-hidden relative">
                    {item.capa ? (
                      <img
                        src={driveImg(item.capa, 80)}
                        className="w-full h-full object-cover"
                        alt={item.titulo}
                        loading="lazy"
                        decoding="async"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <div className="w-full h-full grid place-items-center opacity-30">
                        <TipoIcon className="size-3.5" aria-hidden="true" />
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-[10px] font-black uppercase leading-tight line-clamp-1">{item.titulo}</h3>
                    <p className="text-[9px] text-muted-foreground font-bold truncate">{item.artista}</p>
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

      return (
        <section className="mb-12" aria-labelledby="billboard-h">
          <div className="flex items-center justify-between mb-4">
            <h2 id="billboard-h" className="text-xs font-black uppercase tracking-[0.2em]">
              Billboard Hot 100 #1
            </h2>
          </div>
          <Link
            to="/charts"
            search={{ tab: "hot100" }}
            onClick={() => haptic.light()}
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
          </Link>
        </section>
      );
    },

    topPlataformas: () => (
      <section className="mb-12" aria-labelledby="platforms-h">
        <h2 id="platforms-h" className="text-xs font-black uppercase tracking-[0.2em] mb-4 text-muted-foreground">
          Top por plataforma
        </h2>
        <div className="flex gap-3 overflow-x-auto pb-4 scrollbar-hide -mx-4 px-4 snap-x">
          {Object.entries(config.sections.topPlataformas.links).map(([id]) => {
            const meta = PLATFORM_META[id];
            if (!meta) return null;
            const data = topCharts[id];
            const Icon = meta.icon;
            return (
              <Link
                key={id}
                to="/charts"
                search={{ tab: meta.chartsTab }}
                onClick={() => haptic.light()}
                aria-label={`Abrir parada ${meta.label}`}
                className="min-w-[104px] snap-center group relative overflow-hidden rounded-[1.25rem] border border-white/10 bg-white/5 backdrop-blur-md active:scale-95 transition-all shadow-xl text-left"
              >
                <div className="aspect-square overflow-hidden relative">
                  {data?.foto ? (
                    <img
                      src={driveImg(data.foto, 250)}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                      alt={`${meta.label} #1`}
                      loading="lazy"
                      decoding="async"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div className="w-full h-full bg-secondary flex flex-col items-center justify-center p-2">
                      <Icon className={`size-7 ${meta.color} opacity-30 mb-1`} aria-hidden="true" />
                      <span className="text-[9px] font-bold uppercase opacity-50 text-center">Abrir</span>
                    </div>
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black via-black/20 to-transparent" />
                  <div className="absolute top-2 left-2 size-6 rounded-full bg-black/60 backdrop-blur-md grid place-items-center border border-white/10">
                    <Icon className={`size-3.5 ${meta.color}`} aria-hidden="true" />
                  </div>
                </div>
                <div className="p-2">
                  <span className="text-[9px] font-bold uppercase tracking-wider text-primary mb-0.5 block truncate">{meta.label}</span>
                  <h4 className="text-[11px] font-black uppercase leading-tight line-clamp-1">
                    {data?.musica || "Ver parada"}
                  </h4>
                  <p className="text-[10px] text-muted-foreground font-medium truncate">
                    {data?.artista || "Toque para abrir"}
                  </p>
                </div>
              </Link>
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
          <div className="min-w-0 flex-1">
            {/* Sem truncate — quebra a linha em vez de cortar com "...",
                mas continua no mesmo tamanho/espaçamento de sempre. */}
            <p className="text-base font-black leading-tight break-words">
              Olá, {nomeUsuario}
            </p>
            <p className="text-[11px] uppercase font-bold text-muted-foreground tracking-[0.15em] mt-1">
              Empire <span className="text-primary">Hub</span>
            </p>
          </div>
        </div>
        {/* Prestígio/nível do jogador — no lugar do antigo botão de
            recarregar, redundante com o botão fixo na barra do topo. */}
        {meuNivel?.nivelAtual && (
          <div className="flex flex-col items-end gap-1 shrink-0 max-w-[112px]">
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-amber-500/15 border border-amber-500/25 text-amber-400 text-[10px] font-black uppercase tracking-wide whitespace-nowrap">
              <Trophy className="size-3" aria-hidden="true" />
              Nv {meuNivel.nivelAtual.nivel}
            </span>
            <span className="text-[9px] font-bold text-muted-foreground text-right leading-tight break-words">
              {meuNivel.nivelAtual.nome}
            </span>
          </div>
        )}
      </header>

      <ActivityTicker />

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
                  {/* Sem line-clamp/truncate — título completo sempre visível,
                      quebrando em mais linhas quando precisar, em vez de
                      cortar com reticências. */}
                  <h3 className="text-[11px] font-black uppercase leading-tight">
                    {l.titulo}
                  </h3>
                  <p className="text-[10px] text-muted-foreground font-bold mt-0.5">
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

      <section className="mb-10" aria-labelledby="proximos-eventos-h">
        <h2
          id="proximos-eventos-h"
          className="text-xs font-black uppercase tracking-[0.2em] mb-4"
        >
          Próximos Eventos
        </h2>

        {proximosEventos.status === "loading" ? (
          <div className="flex flex-col gap-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-14 rounded-xl bg-white/5 animate-pulse" />
            ))}
          </div>
        ) : proximosEventos.status === "ok" && proximosEventos.data.length > 0 ? (
          <div className="flex flex-col gap-2">
            {proximosEventos.data.map((ev) => (
              <Link
                key={ev.id}
                to={ev.linkTo as any}
                params={ev.linkParams as any}
                search={ev.linkSearch as any}
                onClick={() => haptic.selection()}
                className="flex items-center gap-3 rounded-xl bg-white/5 border border-white/10 px-3 py-2.5 active:scale-[0.98] transition-all"
              >
                <div className="shrink-0 size-9 rounded-lg bg-white/5 border border-white/10 grid place-items-center">
                  {ev.tipo === "show" ? (
                    <Music2 className="size-4 text-primary" aria-hidden="true" />
                  ) : (
                    <Tv className="size-4 text-primary" aria-hidden="true" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-[11px] font-black uppercase leading-tight">{ev.titulo}</h3>
                  <p className="text-[10px] text-muted-foreground font-bold truncate mt-0.5">{ev.subtitulo}</p>
                </div>
                <div className="shrink-0 flex flex-col items-end gap-0.5 text-right">
                  <span className="flex items-center gap-1 text-[10px] font-black text-foreground/80">
                    <Calendar className="size-3" aria-hidden="true" />
                    {ev.data}
                  </span>
                  {ev.horario ? (
                    <span className="flex items-center gap-1 text-[10px] font-bold text-muted-foreground">
                      <Clock className="size-3" aria-hidden="true" />
                      {ev.horario}
                    </span>
                  ) : null}
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground/60 font-medium">
            Nenhum evento agendado no momento.
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

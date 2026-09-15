import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Send, Radio, Users, Play, ArrowLeft, Calendar, MessageSquare, Info, Archive, ListVideo, Clock, X, Reply, Menu, ChevronLeft, ChevronRight, ImagePlus, Upload, Loader2, VolumeX, Volume2, Minimize2, Sparkles, Heart, Camera, Plus, Trash2 } from "lucide-react";
import logoIcon from "@/assets/logo-icon.png";
import { api, driveImg, driveRawImg, resolveImg, type ProgramaTV, type Artist, type RedCarpetPost } from "@/lib/api";
import { getKickStatus } from "@/lib/kick.functions";
import { getStoredLogin } from "@/components/LoginScreen";
import { useTvPlayer } from "@/components/EmpireTV/TvPlayerContext";
import { resolveStreamEmbed, kickChannelFromUrl, forceUnmuteIframe, hasUnmutedThisSession } from "@/lib/tvEmbed";


export const Route = createFileRoute("/tv")({
  head: () => ({
    meta: [
      { title: "Empire TV" },
      { name: "description", content: "Empire TV — transmissões ao vivo do Empire." },
    ],
  }),
  component: TvPage,
});



type Programa = ProgramaTV;

interface ChatMessage {
  id: string;
  user: string;
  userId?: string;
  userPhoto?: string;
  text: string;
  ts: number;
  color: string;
  reply_to?: { id: string; user: string; text: string };
  // Mensagem exibida localmente antes de confirmar no servidor — some/vira
  // definitiva assim que o insert responde (ver sendRaw).
  pending?: boolean;
}

// *negrito* e _itálico_ (estilo Telegram) — renderiza em partes, sem HTML cru.
function renderFormattedText(text: string) {
  const parts = text.split(/(\*[^*\n]+\*|_[^_\n]+_)/g);
  return parts.map((part, i) => {
    if (part.length > 2 && part.startsWith("*") && part.endsWith("*")) {
      return <strong key={i}>{part.slice(1, -1)}</strong>;
    }
    if (part.length > 2 && part.startsWith("_") && part.endsWith("_")) {
      return <em key={i}>{part.slice(1, -1)}</em>;
    }
    return <span key={i}>{part}</span>;
  });
}

// Mensagens de GIF/sticker guardam só um marcador + a URL do Drive no
// campo de texto (sem mudar o schema da tabela de novo). Celulares muitas
// vezes salvam "GIFs" na galeria como vídeo de verdade (mp4/mov) em vez de
// .gif — por isso existe também o prefixo de vídeo (renderiza <video> em
// loop mudo em vez de <img>).
const GIF_PREFIX = "GIF::";
const VIDEO_GIF_PREFIX = "VIDGIF::";

type HomeTab = "home" | "arquivo" | "grade";
type WatchTab = "chat" | "redcarpet" | "participantes" | "sobre";

// TIPO_EVENTO (Agenda_TV) que habilita a aba Red Carpet na sala — o termo
// usado na planilha é essa única string fixa (as 3 categorias juntas numa
// célula só, não 3 valores separados): "EVENTOS OFICIAIS, PREMIAÇÕES,
// SUPERBOWL". Comparado sem acento/espaço extra/caixa pra não depender de
// digitação exata.
function semAcento(s: string) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}
const RED_CARPET_TIPO_EVENTO = semAcento("EVENTOS OFICIAIS, PREMIAÇÕES, SUPERBOWL".toUpperCase());
function temRedCarpet(programa: Programa) {
  const norm = semAcento((programa.tipo_evento || "").trim().toUpperCase()).replace(/\s+/g, " ");
  return norm === RED_CARPET_TIPO_EVENTO;
}

// Prefixo usado na mensagem de sistema do Chat quando um look é publicado no
// Red Carpet — carrega o postId (pra navegar direto até ele) e o nome exato
// da sala (coluna "Programa" da Agenda_TV, ex: "Testes RC"), não um texto
// genérico. Formato: RC_ARRIVAL::postId::Nome do artista::Nome do programa
const RC_ARRIVAL_PREFIX = "RC_ARRIVAL::";

// Insere direto na mesma tabela Supabase que o ChatPanel já escuta em tempo
// real (tv_chat_messages) — não precisa de nenhuma referência ao ChatPanel
// montado, então funciona mesmo publicando a partir da aba Red Carpet.
async function sendRedCarpetArrivalMessage(programaId: string, postId: string, artistaNome: string, programaTitulo: string, artistaFoto?: string) {
  try {
    const { supabase } = await import("@/integrations/supabase/client");
    await supabase.from("tv_chat_messages").insert({
      programa_id: programaId,
      user_name: artistaNome.slice(0, 60),
      user_id: null,
      user_photo: artistaFoto || null,
      text: `${RC_ARRIVAL_PREFIX}${postId}::${artistaNome}::${programaTitulo}`.slice(0, 500),
      reply_to: null,
    });
  } catch (err) {
    console.warn("[sendRedCarpetArrivalMessage] Falha ao avisar no chat:", err);
  }
}

const NAME_COLORS = [
  "text-rose-400", "text-amber-400", "text-emerald-400", "text-sky-400",
  "text-violet-400", "text-pink-400", "text-orange-400", "text-teal-400",
];

function colorFor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return NAME_COLORS[h % NAME_COLORS.length];
}

// "DD/MM/YYYY HH:mm" → Date
function parseProgramDate(p: Programa): Date | null {
  const s = (p.data_inicio || `${p.data || ""} ${p.horario || ""}`).trim();
  const m = s.match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), Number(m[4]), Number(m[5]));
}

function TvPage() {
  const { watching, floating, open: setWatching, minimize, restore, close: stopWatching, updateWatching } = useTvPlayer();
  const [programasRaw, setProgramasRaw] = useState<Programa[]>([]);
  const [loading, setLoading] = useState(true);
  const [liveChannels, setLiveChannels] = useState<Record<string, { viewers?: number; title?: string }>>({});
  const fetchKick = useServerFn(getKickStatus);

  // Recarrega a grade periodicamente — antes buscava só uma vez ao abrir a
  // tela, então marcar uma transmissão como "ao vivo" na planilha (pra
  // canais que não são Kick, cuja checagem abaixo só cobre Kick) só
  // aparecia pra quem desse reload manual na página. Com o polling, todo
  // mundo já vendo a tela do TV pega a mudança sozinho.
  useEffect(() => {
    let alive = true;
    const load = () => {
      api.listarProgramasTV()
        .then((list) => alive && setProgramasRaw(list))
        .catch(() => {})
        .finally(() => alive && setLoading(false));
    };
    load();
    const id = setInterval(load, 12_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  // Detecta ao vivo direto pela API do Kick (fonte da verdade).
  useEffect(() => {
    let alive = true;
    const channels = new Set<string>();
    for (const p of programasRaw) {
      const slug = kickChannelFromUrl(p.stream_url);
      if (slug) channels.add(slug);
    }
    if (channels.size === 0) { setLiveChannels({}); return; }

    const tick = async () => {
      const entries = await Promise.all(
        Array.from(channels).map(async (ch) => {
          try {
            const r = await fetchKick({ data: { channel: ch } });
            return [ch, r] as const;
          } catch { return [ch, { live: false, channel: ch }] as const; }
        })
      );
      if (!alive) return;
      const next: Record<string, { viewers?: number; title?: string }> = {};
      for (const [ch, r] of entries) if (r.live) next[ch] = { viewers: r.viewers, title: r.title };
      setLiveChannels(next);
    };
    tick();
    const id = setInterval(tick, 12_000);
    return () => { alive = false; clearInterval(id); };
  }, [programasRaw, fetchKick]);

  // Mescla: força ao_vivo=true (e tira finalizado) para qualquer programa cujo canal Kick esteja ao vivo agora.
  const programas = useMemo<Programa[]>(() => {
    return programasRaw.map((p) => {
      const slug = kickChannelFromUrl(p.stream_url);
      const live = slug ? liveChannels[slug] : undefined;
      if (!live) return p;
      return { ...p, ao_vivo: true, finalizado: false, espectadores: live.viewers ?? p.espectadores };
    });
  }, [programasRaw, liveChannels]);

  // Mantém o programa em exibição sincronizado quando o status ao vivo muda.
  useEffect(() => {
    if (!watching) return;
    const updated = programas.find((p) => p.id === watching.id);
    if (updated && (updated.ao_vivo !== watching.ao_vivo || updated.espectadores !== watching.espectadores)) {
      updateWatching(updated);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [programas]);

  // Voltar pra /tv com o player minimizado (ex.: veio de outra aba do app
  // enquanto assistia) já restaura a tela cheia, sem precisar tocar na
  // miniatura flutuante primeiro.
  useEffect(() => {
    if (watching && floating) restore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className={`fixed inset-0 bg-background text-foreground overflow-hidden transition-all ${
        watching && !floating ? "z-[70]" : "top-[calc(4rem+env(safe-area-inset-top))] bottom-[calc(4rem+env(safe-area-inset-bottom))]"
      }`}
    >
      {watching && !floating ? (
        <WatchView programa={watching} onBack={stopWatching} onMinimize={minimize} />
      ) : (
        <BrowseView programas={programas} loading={loading} onPlay={setWatching} />
      )}
    </div>
  );
}


// ---------- BrowseView (home + arquivo + grade) ----------
function BrowseView({ programas, loading, onPlay }: { programas: Programa[]; loading: boolean; onPlay: (p: Programa) => void }) {
  const [tab, setTab] = useState<HomeTab>("home");

  const aoVivo = useMemo(() => programas.filter((p) => p.ao_vivo), [programas]);
  const agora = Date.now();
  const futuros = useMemo(() => {
    return programas
      .filter((p) => !p.ao_vivo && !p.finalizado)
      .map((p) => ({ p, d: parseProgramDate(p) }))
      .filter((x) => !x.d || x.d.getTime() > agora)
      .sort((a, b) => (a.d?.getTime() || 0) - (b.d?.getTime() || 0))
      .map((x) => x.p);
  }, [programas, agora]);
  const finalizados = useMemo(() => {
    return programas
      .filter((p) => p.finalizado)
      .map((p) => ({ p, d: parseProgramDate(p) }))
      .sort((a, b) => (b.d?.getTime() || 0) - (a.d?.getTime() || 0))
      .map((x) => x.p);
  }, [programas]);

  // por categoria (pra montar as fileiras tipo "catálogo")
  const porCategoria = useMemo(() => {
    const map = new Map<string, Programa[]>();
    for (const p of programas) {
      const k = (p.categoria || "Outros").trim() || "Outros";
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(p);
    }
    return Array.from(map.entries()).filter(([, arr]) => arr.length > 0);
  }, [programas]);

  const featured = aoVivo[0] || futuros[0] || finalizados[0] || programas[0] || null;
  const featuredKind: "live" | "next" | "past" | null = !featured
    ? null
    : aoVivo[0]
    ? "live"
    : futuros[0]
    ? "next"
    : "past";

  const tabs: { id: HomeTab; label: string; icon: typeof MessageSquare }[] = [
    { id: "home", label: "Início", icon: Play },
    { id: "grade", label: "Grade", icon: ListVideo },
    { id: "arquivo", label: "Arquivo", icon: Archive },
  ];

  return (
    <div className="h-full flex">
      {/* Rail lateral estilo Twitch */}
      <TwitchRail tabs={tabs} active={tab} onChange={setTab} aoVivo={aoVivo} onPlay={onPlay} />

      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex-1 overflow-y-auto">
          {tab === "home" && (
            <HomeTabView
              loading={loading}
              featured={featured}
              featuredKind={featuredKind}
              aoVivo={aoVivo}
              futuros={futuros}
              finalizados={finalizados}
              porCategoria={porCategoria}
              onPlay={onPlay}
            />
          )}
          {tab === "grade" && <GradeFull programas={futuros} onPlay={onPlay} loading={loading} />}
          {tab === "arquivo" && <ArquivoFull finalizados={finalizados} loading={loading} />}
        </div>
      </div>
    </div>
  );
}

function TwitchRail({
  tabs, active, onChange, aoVivo, onPlay,
}: {
  tabs: { id: HomeTab; label: string; icon: typeof MessageSquare }[];
  active: HomeTab;
  onChange: (id: HomeTab) => void;
  aoVivo: Programa[];
  onPlay: (p: Programa) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <aside
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
      className={`h-full shrink-0 border-r border-border/60 bg-background/95 backdrop-blur flex flex-col transition-[width] duration-200 ease-out ${expanded ? "w-56" : "w-14"}`}
    >
      <div className="h-12 flex items-center gap-2 px-3 border-b border-border/60 shrink-0">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="size-8 rounded-md hover:bg-muted flex items-center justify-center shrink-0"
          aria-label={expanded ? "Recolher menu" : "Expandir menu"}
        >
          {expanded ? <X className="size-4" /> : <Menu className="size-4" />}
        </button>
        {expanded && <span className="text-[11px] uppercase tracking-[0.18em] font-black text-muted-foreground truncate">Empire TV</span>}
      </div>

      <nav className="py-2 flex flex-col gap-0.5">
        {tabs.map((t) => {
          const Icon = t.icon;
          const isActive = active === t.id;
          return (
            <button
              key={t.id}
              onClick={() => onChange(t.id)}
              title={t.label}
              className={`mx-1 h-10 rounded-md flex items-center gap-3 px-2.5 text-sm font-semibold transition relative ${
                isActive ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted"
              }`}
            >
              {isActive && <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r bg-primary" />}
              <Icon className="size-[18px] shrink-0" />
              {expanded && <span className="truncate">{t.label}</span>}
            </button>
          );
        })}
      </nav>

      {(() => {
        // dedup por canal Kick — uma transmissão = um ícone no rail
        const seen = new Set<string>();
        const uniqueLive: Programa[] = [];
        for (const p of aoVivo) {
          const slug = kickChannelFromUrl(p.stream_url) || `id:${p.id}`;
          if (seen.has(slug)) continue;
          seen.add(slug);
          uniqueLive.push(p);
        }
        if (uniqueLive.length === 0) return null;
        return (
          <div className="mt-3 border-t border-border/60 pt-3 flex-1 overflow-y-auto">
            {expanded && (
              <div className="px-3 mb-2 text-[10px] uppercase tracking-widest font-black text-muted-foreground flex items-center gap-1.5">
                <Radio className="size-3 text-red-400 animate-pulse" /> No ar
              </div>
            )}
            <div className="flex flex-col gap-0.5">
              {uniqueLive.slice(0, 8).map((p) => (
                <button
                  key={p.id}
                  onClick={() => onPlay(p)}
                  title={p.titulo}
                  className="mx-1 h-10 rounded-md flex items-center gap-3 px-1.5 hover:bg-muted text-left transition"
                >
                  <div className="size-7 rounded-full overflow-hidden bg-muted shrink-0 grid place-items-center">
                    {p.cover ? (
                      <img src={resolveImg(p.cover)} alt={p.titulo} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                    ) : (
                      <Radio className="size-3 text-muted-foreground" />
                    )}
                  </div>
                  {expanded && (
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-semibold truncate">{p.titulo}</div>
                      <div className="text-[10px] text-red-400 flex items-center gap-1"><span className="size-1.5 rounded-full bg-red-500 animate-pulse" /> ao vivo</div>
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>
        );
      })()}
    </aside>
  );
}

function HomeTabView({
  loading, featured, featuredKind, aoVivo, futuros, finalizados, porCategoria, onPlay,
}: {
  loading: boolean;
  featured: Programa | null;
  featuredKind: "live" | "next" | "past" | null;
  aoVivo: Programa[];
  futuros: Programa[];
  finalizados: Programa[];
  porCategoria: Array<[string, Programa[]]>;
  onPlay: (p: Programa) => void;
}) {
  if (loading && !featured) {
    return <div className="h-full flex items-center justify-center text-sm text-muted-foreground p-10">Carregando catálogo...</div>;
  }
  if (!featured) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-sm text-muted-foreground p-10 text-center gap-2">
        <span>O catálogo ainda não chegou.</span>
        <span className="text-xs">Verifique se o Apps Script foi republicado com a ação <code>listar_programas_tv</code>.</span>
      </div>
    );
  }

  const badge =
    featuredKind === "live"
      ? { cls: "bg-red-500/20 text-red-400", icon: <Radio className="size-3 animate-pulse" />, label: "AO VIVO" }
      : featuredKind === "next"
      ? { cls: "bg-amber-500/20 text-amber-400", icon: <Clock className="size-3" />, label: "PRÓXIMA ATRAÇÃO" }
      : { cls: "bg-zinc-500/20 text-zinc-300", icon: <Archive className="size-3" />, label: "EM CATÁLOGO" };

  return (
    <>
      <div className="relative w-full h-[55vh] min-h-[320px] overflow-hidden">
        {featured.cover ? (
          <img src={resolveImg(featured.cover)} alt={featured.titulo} className="absolute inset-0 w-full h-full object-cover" referrerPolicy="no-referrer" />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-primary/30 to-muted" />
        )}
        {/* Antes essas duas camadas se somavam (blend de opacidade) e no
            canto inferior esquerdo — onde fica todo o texto — ficava quase
            opaco, escondendo o banner quase inteiro. Uma só, mais suave,
            ainda garante legibilidade do texto sem tapar a imagem. */}
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/35 to-transparent" />
        <div className="relative h-full flex flex-col justify-end p-6 max-w-2xl">
          <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-bold w-fit mb-2 ${badge.cls}`}>
            {badge.icon} {badge.label}
          </span>
          <h1 className="text-4xl sm:text-5xl font-black tracking-tight">{featured.titulo}</h1>
          {featured.subtitulo && <p className="mt-2 text-sm sm:text-base text-muted-foreground max-w-xl">{featured.subtitulo}</p>}
          <div className="mt-3 flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
            {featured.categoria && <span>{featured.categoria}</span>}
            {featured.data_inicio && (<><span>•</span><span className="flex items-center gap-1"><Calendar className="size-3" /> {featured.data_inicio}</span></>)}
          </div>
          {featuredKind !== "next" && (
            <div className="mt-5 flex items-center gap-3">
              <button onClick={() => onPlay(featured)} className="h-11 px-6 rounded-md bg-primary text-primary-foreground font-bold text-sm flex items-center gap-2 hover:bg-primary/90 transition">
                <Play className="size-4 fill-current" /> {featuredKind === "live" ? "Assistir agora" : "Assistir"}
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="px-4 py-6 space-y-8">
        {aoVivo.length > 0 && <ProgramRow title="No ar agora" programas={aoVivo} onPlay={onPlay} />}
        {futuros.length > 0 && <ProgramRow title="Em breve" programas={futuros} onPlay={onPlay} showSchedule />}
        {finalizados.length > 0 && <ProgramRow title="Já passou" programas={finalizados} onPlay={onPlay} showSchedule />}
        {porCategoria.map(([cat, arr]) => (
          <ProgramRow key={cat} title={cat} programas={arr} onPlay={onPlay} />
        ))}
      </div>
    </>
  );
}

function ProgramRow({ title, programas, onPlay, showSchedule, emptyText }: {
  title: string; programas: Programa[]; onPlay: (p: Programa) => void; showSchedule?: boolean; emptyText?: string;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  const updateArrows = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    setCanLeft(el.scrollLeft > 4);
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }, []);

  useEffect(() => {
    updateArrows();
    const el = scrollerRef.current;
    if (!el) return;
    el.addEventListener("scroll", updateArrows, { passive: true });
    const ro = new ResizeObserver(updateArrows);
    ro.observe(el);
    return () => { el.removeEventListener("scroll", updateArrows); ro.disconnect(); };
  }, [updateArrows, programas.length]);

  const scrollBy = (dir: 1 | -1) => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.round(el.clientWidth * 0.85), behavior: "smooth" });
  };

  return (
    <section>
      <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-3">{title}</h2>
      {programas.length === 0 ? (
        <div className="text-xs text-muted-foreground italic">{emptyText || "Em breve."}</div>
      ) : (
        <div className="relative group/row -mx-1">
          {/* fades nas bordas */}
          <div className={`pointer-events-none absolute top-0 bottom-2 left-0 w-10 bg-gradient-to-r from-background to-transparent z-10 transition-opacity ${canLeft ? "opacity-100" : "opacity-0"}`} />
          <div className={`pointer-events-none absolute top-0 bottom-2 right-0 w-10 bg-gradient-to-l from-background to-transparent z-10 transition-opacity ${canRight ? "opacity-100" : "opacity-0"}`} />

          {/* seta esquerda */}
          <button
            type="button"
            onClick={() => scrollBy(-1)}
            aria-label="Anterior"
            className={`hidden sm:flex absolute left-1 top-1/2 -translate-y-1/2 z-20 size-9 rounded-full items-center justify-center border border-white/10 bg-background/60 backdrop-blur-md text-foreground shadow-lg transition-all ${canLeft ? "opacity-0 group-hover/row:opacity-100" : "opacity-0 pointer-events-none"} hover:bg-background/80 hover:scale-105`}
          >
            <ChevronLeft className="size-5" />
          </button>
          {/* seta direita */}
          <button
            type="button"
            onClick={() => scrollBy(1)}
            aria-label="Próximo"
            className={`hidden sm:flex absolute right-1 top-1/2 -translate-y-1/2 z-20 size-9 rounded-full items-center justify-center border border-white/10 bg-background/60 backdrop-blur-md text-foreground shadow-lg transition-all ${canRight ? "opacity-0 group-hover/row:opacity-100" : "opacity-0 pointer-events-none"} hover:bg-background/80 hover:scale-105`}
          >
            <ChevronRight className="size-5" />
          </button>

          <div
            ref={scrollerRef}
            className="flex gap-3 overflow-x-auto pb-2 px-1 snap-x scroll-smooth [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
          >
            {programas.map((p) => (
              <button key={p.id} onClick={() => onPlay(p)} className="snap-start shrink-0 w-64 group text-left">
                <div className="relative aspect-video rounded-md overflow-hidden bg-muted">
                  {p.cover ? (
                    <img src={resolveImg(p.cover)} alt={p.titulo} className="w-full h-full object-cover group-hover:scale-105 transition-transform" referrerPolicy="no-referrer" />
                  ) : (
                    <div className="w-full h-full bg-gradient-to-br from-primary/20 to-muted" />
                  )}
                  {p.ao_vivo && (
                    <span className="absolute top-2 left-2 flex items-center gap-1 px-1.5 py-0.5 rounded bg-red-500 text-white text-[10px] font-bold">
                      <Radio className="size-2.5" /> LIVE
                    </span>
                  )}
                  {showSchedule && p.data_inicio && (
                    <span className="absolute top-2 right-2 flex items-center gap-1 px-1.5 py-0.5 rounded bg-black/60 text-white text-[10px] font-semibold">
                      <Calendar className="size-2.5" /> {p.data_inicio}
                    </span>
                  )}
                </div>
                <div className="mt-2 text-sm font-semibold truncate">{p.titulo}</div>
                <div className="text-xs text-muted-foreground truncate">{p.categoria}</div>
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function GradeFull({ programas, onPlay, loading }: { programas: Programa[]; onPlay: (p: Programa) => void; loading: boolean }) {
  if (loading && programas.length === 0) return <div className="p-6 text-sm text-muted-foreground">Carregando...</div>;
  if (programas.length === 0) return <div className="p-6 text-sm text-muted-foreground italic">Sem programas agendados.</div>;
  return (
    <div className="p-4 space-y-2">
      <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-2">Grade — próximas atrações</h2>
      {programas.map((p) => (
        <button key={p.id} onClick={() => onPlay(p)} className="w-full flex gap-3 p-2 rounded-md hover:bg-muted text-left">
          <div className="w-28 aspect-video rounded overflow-hidden bg-muted shrink-0">
            {p.cover && <img src={resolveImg(p.cover)} alt={p.titulo} className="w-full h-full object-cover" referrerPolicy="no-referrer" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold truncate">{p.titulo}</div>
            <div className="text-xs text-muted-foreground truncate">{p.subtitulo || p.categoria}</div>
            <div className="text-[11px] text-muted-foreground mt-1 flex items-center gap-1">
              <Calendar className="size-3" /> {p.data_inicio}
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}

function ArquivoFull({ finalizados, loading }: { finalizados: Programa[]; loading: boolean }) {
  const [chatByPrograma, setChatByPrograma] = useState<Map<string, number>>(new Map());
  const [loadChat, setLoadChat] = useState(true);
  const idsKey = useMemo(() => finalizados.map((p) => p.id).join(","), [finalizados]);

  // Total de mensagens por programa direto do chat real (Supabase) — a
  // aba "Agenda_TV" antiga (listar_arquivo_tv) nunca é mais escrita desde
  // que o chat virou realtime, então usar ela aqui mostraria sempre 0.
  useEffect(() => {
    let alive = true;
    const ids = finalizados.map((p) => p.id).filter(Boolean);
    if (ids.length === 0) {
      setChatByPrograma(new Map());
      setLoadChat(false);
      return;
    }
    setLoadChat(true);
    (async () => {
      const { supabase } = await import("@/integrations/supabase/client");
      const { data } = await supabase
        .from("tv_chat_messages")
        .select("programa_id")
        .in("programa_id", ids)
        .limit(20000);
      if (!alive) return;
      const m = new Map<string, number>();
      for (const r of data || []) m.set(r.programa_id, (m.get(r.programa_id) || 0) + 1);
      setChatByPrograma(m);
    })()
      .catch(() => {})
      .finally(() => alive && setLoadChat(false));
    return () => { alive = false; };
  }, [idsKey]);

  if (loading && finalizados.length === 0) return <div className="p-6 text-sm text-muted-foreground">Carregando...</div>;
  if (finalizados.length === 0) return <div className="p-6 text-sm text-muted-foreground italic">Sem transmissões finalizadas.</div>;
  return (
    <div className="p-4 space-y-2">
      <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-2">Arquivo — transmissões passadas</h2>
      {finalizados.map((p) => (
        <div key={p.id} className="flex gap-3 p-2 rounded-md hover:bg-muted">
          <div className="w-28 aspect-video rounded overflow-hidden bg-muted shrink-0">
            {p.cover && <img src={resolveImg(p.cover)} alt={p.titulo} className="w-full h-full object-cover" referrerPolicy="no-referrer" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold truncate">{p.titulo}</div>
            <div className="text-xs text-muted-foreground truncate">{p.subtitulo || p.categoria}</div>
            <div className="text-[11px] text-muted-foreground mt-1 flex items-center gap-2 flex-wrap">
              <span className="flex items-center gap-1"><Calendar className="size-3" /> {p.data_inicio}</span>
              {chatByPrograma.has(p.id) && (
                <span className="flex items-center gap-1"><MessageSquare className="size-3" /> {chatByPrograma.get(p.id)} msgs</span>
              )}
            </div>
          </div>
        </div>
      ))}
      {loadChat && <div className="text-[11px] text-muted-foreground mt-2">Carregando chats arquivados...</div>}
    </div>
  );
}

// O layout mobile/desktop usava só CSS (lg:hidden / hidden lg:flex) pra
// alternar os dois blocos — só que os dois ficavam MONTADOS no DOM ao
// mesmo tempo (um só "hidden" via CSS), e cada um tinha seu próprio
// {player}, ou seja, DOIS iframes da transmissão tocando ao mesmo tempo.
// No iOS isso passava despercebido (o navegador geralmente pausa mídia de
// iframe escondido), mas no Android os dois continuam tocando — daí o
// áudio duplicado. Aqui a gente decide via JS qual bloco existe de fato,
// garantindo um único player montado por vez.
function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    setIsDesktop(mq.matches);
    const onChange = () => setIsDesktop(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return isDesktop;
}

// Acompanha window.visualViewport (altura visível de verdade + quanto a
// página foi "panada" pra cima) — usado pra manter vídeo/cabeçalho
// realmente visíveis quando o teclado abre no iOS Safari. position:fixed/
// absolute sozinhos não bastam: no iOS, focar um campo às vezes PANA a
// página (desloca tudo pra cima, inclusive elementos fixed) em vez de
// encolher a viewport, e como visualViewport.height/offsetTop refletem
// exatamente a área visível a qualquer momento, corrigir com base neles
// funciona nos dois comportamentos (resize OU pan), sem adivinhar qual
// o navegador vai escolher.
function useVisualViewport() {
  const [vv, setVv] = useState<{ height: number; offsetTop: number } | null>(null);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () => setVv({ height: viewport.height, offsetTop: viewport.offsetTop });
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
    };
  }, []);
  return vv;
}

// ---------- WatchView (chat + participantes + sobre) ----------
function WatchView({ programa, onBack, onMinimize }: { programa: Programa; onBack: () => void; onMinimize: () => void }) {
  // Identidade vem só do login próprio (aba Usuários) — sem depender do
  // Telegram pra nada.
  const login = getStoredLogin();
  const myId = login?.id;
  const myName = login?.nome;
  const vv = useVisualViewport();
  const [tab, setTab] = useState<WatchTab>("chat");
  const isDesktop = useIsDesktop();

  // Heartbeat de presença
  useEffect(() => {
    if (!myId) return;
    const start = Date.now();
    let accumulated = 0;
    let lastTick = start;
    let visible = !document.hidden;

    const onVis = () => {
      if (document.hidden) {
        if (visible) accumulated += Math.floor((Date.now() - lastTick) / 1000);
        visible = false;
      } else {
        visible = true;
        lastTick = Date.now();
      }
    };
    document.addEventListener("visibilitychange", onVis);

    const send = (extraSeconds = 0) => {
      const total = accumulated + extraSeconds;
      if (total < 5) return;
      api.registrarPresencaTV({
        programa_id: programa.id,
        telegram_id: myId,
        nome: myName || "Anônimo",
        watched_seconds: total,
      }).catch(() => {});
    };

    const interval = setInterval(() => {
      if (visible) {
        const now = Date.now();
        accumulated += Math.floor((now - lastTick) / 1000);
        lastTick = now;
        send();
      }
    }, 30_000);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVis);
      const extra = visible ? Math.floor((Date.now() - lastTick) / 1000) : 0;
      send(extra);
    };
  }, [programa.id, myId, myName]);

  // Red Carpet sempre logo ao lado de Chat — só existe quando o TIPO_EVENTO
  // da sala está na lista (Eventos Oficiais/Premiações/Superbowl).
  const tabs: { id: WatchTab; label: string; icon: typeof MessageSquare }[] = [
    { id: "chat", label: "Chat", icon: MessageSquare },
    ...(temRedCarpet(programa) ? [{ id: "redcarpet" as WatchTab, label: "Red Carpet", icon: Sparkles }] : []),
    { id: "participantes", label: "Participantes", icon: Users },
    { id: "sobre", label: "Sobre", icon: Info },
  ];

  // postId destacado quando a pessoa clica no aviso "chegou ao Programa" no
  // Chat — RedCarpetPanel usa isso pra rolar/realçar o look em questão.
  const [highlightPostId, setHighlightPostId] = useState<string | null>(null);
  const openRedCarpetPost = (postId: string) => {
    setHighlightPostId(postId);
    setTab("redcarpet");
  };

  // O navegador força o autoplay como mudo até haver uma interação real do
  // usuário — como o player é um iframe de outro domínio (Kick/YouTube),
  // não dá pra ativar o som via código nosso sem essa interação acontecer
  // dentro dele. forceUnmuteIframe (lib/tvEmbed) recria o NÓ do iframe de
  // forma síncrona dentro do próprio clique — só trocar o "src" do mesmo
  // elemento parou de bastar em navegadores recentes pra esse tipo de
  // navegação cross-origin (endurecimento anti-abuso), então o botão tinha
  // parado de funcionar de verdade mesmo clicando nele.
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [unmutedOnce, setUnmutedOnce] = useState(false);
  const handleUnmute = () => {
    const el = iframeRef.current;
    if (!el) return;
    setUnmutedOnce(true);
    iframeRef.current = forceUnmuteIframe(el);
  };
  useEffect(() => {
    setUnmutedOnce(false);
  }, [programa.id]);

  const player = (() => {
    const embed = resolveStreamEmbed(programa.stream_url, !!programa.ao_vivo);
    if (embed) {
      return (
        <div className="relative w-full h-full">
          <iframe
            ref={iframeRef}
            src={embed}
            title={programa.titulo}
            className="w-full h-full border-0 block"
            allow="autoplay; camera; microphone; fullscreen; encrypted-media; picture-in-picture"
            allowFullScreen
          />
          {/* Depois do primeiro toque bem-sucedido nesta sessão, troca o aviso
              grande por um ícone discreto — cada transmissão nova ainda exige
              um toque de verdade (é o navegador quem exige, não dá pra
              pular), mas não precisa mais do aviso chamativo repetido. */}
          <button
            type="button"
            onClick={handleUnmute}
            className={
              unmutedOnce || hasUnmutedThisSession()
                ? "absolute bottom-3 left-3 z-10 size-8 rounded-full bg-black/60 backdrop-blur text-white flex items-center justify-center shadow-lg active:scale-95 transition"
                : "absolute bottom-3 left-3 z-10 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-black/60 backdrop-blur text-white text-xs font-semibold shadow-lg active:scale-95 transition"
            }
            aria-label="Ativar som"
          >
            {unmutedOnce ? <Volume2 className="size-3.5" /> : <><VolumeX className="size-3.5" /> {!hasUnmutedThisSession() && "Toque para ativar o som"}</>}
          </button>
        </div>
      );
    }
    const hasKick = !!programa.stream_url && /kick\.com/.test(programa.stream_url);
    const waiting = hasKick && !programa.ao_vivo;
    return (
      <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-center px-4">
        {waiting ? (
          <>
            <div className="size-8 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
            <span className="text-sm text-foreground font-semibold">Aguardando início da transmissão</span>
            <span className="text-xs text-muted-foreground">O player será ativado quando o canal estiver ao vivo.</span>
          </>
        ) : (
          <span className="text-xs text-muted-foreground">Sem vídeo.</span>
        )}
      </div>
    );
  })();

  const header = (
    <div
      className="flex items-center gap-2 px-3 shrink-0 bg-background/95 backdrop-blur border-b border-border/60"
      style={{ paddingTop: "env(safe-area-inset-top)", height: "calc(3rem + env(safe-area-inset-top))" }}
    >
      <button onClick={onBack} className="size-8 rounded-full hover:bg-muted flex items-center justify-center shrink-0" aria-label="Voltar">
        <ArrowLeft className="size-4" />
      </button>
      <div className="min-w-0 flex-1 truncate text-sm font-semibold">{programa.titulo}</div>
      {programa.ao_vivo && (
        <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-red-500 text-white text-[10px] font-bold shrink-0">
          <Radio className="size-2.5 animate-pulse" /> LIVE
        </span>
      )}
      <button onClick={onMinimize} className="size-8 rounded-full hover:bg-muted flex items-center justify-center shrink-0" aria-label="Minimizar (continua tocando)" title="Minimizar — continua tocando">
        <Minimize2 className="size-4" />
      </button>
    </div>
  );

  const tabBar = (
    <div className="flex items-center gap-1 px-2 h-10 border-b border-border shrink-0 overflow-x-auto">
      {tabs.map((t) => {
        const Icon = t.icon;
        const active = tab === t.id;
        return (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`relative shrink-0 h-8 px-2.5 rounded-md text-xs font-semibold flex items-center gap-1.5 transition active:scale-95 ${
              active
                ? "text-primary-foreground shadow-[0_4px_14px_-4px_var(--primary)]"
                : "text-muted-foreground border border-white/10 bg-white/[0.03] backdrop-blur-md hover:bg-white/[0.06]"
            }`}
          >
            {active && <span className="absolute inset-0 rounded-md bg-gradient-to-br from-primary via-primary to-fuchsia-500/80" aria-hidden="true" />}
            <Icon className="relative z-10 size-3.5" /> <span className="relative z-10">{t.label}</span>
          </button>
        );
      })}
    </div>
  );

  const panel = (
    <div className="flex-1 min-h-0 flex flex-col">
      {tab === "chat" && <ChatPanel programaId={programa.id} onOpenRedCarpetPost={openRedCarpetPost} />}
      {tab === "redcarpet" && (
        <RedCarpetPanel programa={programa} highlightPostId={highlightPostId} onHighlightConsumed={() => setHighlightPostId(null)} />
      )}
      {tab === "participantes" && <ParticipantesPanel programa={programa} />}
      {tab === "sobre" && <SobrePanel programa={programa} />}
    </div>
  );

  // ---------- Mobile: vídeo em bloco fixo no topo (não tela cheia) + chat
  // SEMPRE visível logo abaixo, sem gaveta que soma/sobrepõe o vídeo — vídeo
  // e teclado nunca disputam o mesmo espaço, porque nenhum dos dois cobre o
  // outro: cada um vive na sua própria faixa da tela o tempo todo. ----------
  if (!isDesktop) {
    // Vídeo + cabeçalho ficam em "position: absolute" (não itens normais de
    // flex) e o painel de chat ocupa o resto via "position: absolute" com
    // "top" calculado — de propósito, não é só estética. Como itens comuns
    // de flex, quando o Safari rola pra revelar o campo de digitar acima do
    // teclado, ele rola a COLUNA INTEIRA (arrastando vídeo e cabeçalho pra
    // fora da tela junto, foi exatamente isso que aconteceu). "absolute"
    // tira os dois de qualquer fluxo/scroll ancestral — só quem pode rolar
    // é o scroller interno do próprio ChatPanel (ver comentário lá dentro).
    const videoHeight = "calc(3rem + env(safe-area-inset-top) + 100vw * 9 / 16)";
    return (
      <div
        className="relative bg-background overflow-hidden"
        style={{
          // window.visualViewport, quando disponível, é a área REALMENTE
          // visível (já descontando o teclado) — mais confiável que h-full/
          // 100dvh nesse cenário específico, porque o iOS às vezes pana a
          // página em vez de encolher a viewport.
          height: vv ? vv.height : "100%",
          transform: vv?.offsetTop ? `translateY(${vv.offsetTop}px)` : undefined,
        }}
      >
        <div className="absolute top-0 inset-x-0 z-20">
          {header}
          <div className="w-full bg-black" style={{ aspectRatio: "16 / 9" }}>{player}</div>
        </div>
        <div className="absolute inset-x-0 bottom-0 flex flex-col" style={{ top: videoHeight }}>
          {tabBar}
          {panel}
        </div>
      </div>
    );
  }

  // ---------- Desktop: player + painel lateral fixo ----------
  return (
    <div className="flex h-full min-h-0">
      <div className="flex-1 flex flex-col min-w-0">
        {header}
        <div className="w-full bg-black" style={{ aspectRatio: "16 / 9" }}>{player}</div>
      </div>

      <div className="lg:w-[360px] border-l border-border flex flex-col min-h-0 bg-card/30">
        {tabBar}
        {panel}
      </div>
    </div>
  );
}

// ---------- Chat (realtime via Lovable Cloud) ----------
function ChatPanel({ programaId, onOpenRedCarpetPost }: { programaId: string; onOpenRedCarpetPost: (postId: string) => void }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [sending, setSending] = useState(false);
  const [gifPickerOpen, setGifPickerOpen] = useState(false);
  const [gifs, setGifs] = useState<Array<{ id: string; name: string; url: string; isVideo?: boolean }> | null>(null);
  const [uploadingGif, setUploadingGif] = useState(false);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const gifFileRef = useRef<HTMLInputElement>(null);
  // Identidade vem só do login próprio (aba Usuários) — sem Telegram.
  const login = getStoredLogin();
  const displayName = login?.nome || "Anônimo";
  const myId = login?.id;
  const myPhoto = login?.fotoPerfil || "";

  // Histórico inicial + subscrição realtime — celular em segundo plano
  // (troca de app, tela apagada) costuma derrubar o websocket em silêncio,
  // sem disparar nenhum evento de erro; o app só reconectava se a pessoa
  // saísse e voltasse pro chat (remontando o componente do zero). Agora,
  // sempre que a aba volta a ficar visível, refaz a busca do histórico
  // (pra recuperar o que passou enquanto a conexão estava morta) e recria
  // a subscrição — sem precisar sair de lugar nenhum.
  useEffect(() => {
    let alive = true;
    let channel: any = null;

    const fetchHistory = async () => {
      const { supabase } = await import("@/integrations/supabase/client");
      // `order(ascending: true).limit(300)` pegava sempre as 300 mensagens
      // MAIS ANTIGAS do programa — depois que um show ao vivo passava desse
      // total, toda mensagem nova sumia de quem recarregava/voltava pro chat
      // (fetchHistory roda de novo a cada visibilitychange). Busca as 300
      // mais RECENTES (ordem decrescente) e desfaz a ordem só na exibição.
      const { data } = await supabase
        .from("tv_chat_messages")
        .select("id,user_name,user_id,user_photo,text,reply_to,created_at")
        .eq("programa_id", programaId)
        .order("created_at", { ascending: false })
        .limit(300);
      if (!alive || !data) return;
      setMessages(
        data
          .slice()
          .reverse()
          .map((r: any) => ({
            id: r.id,
            user: r.user_name,
            userId: r.user_id || undefined,
            userPhoto: r.user_photo || undefined,
            text: r.text,
            ts: new Date(r.created_at).getTime(),
            color: colorFor(r.user_name),
            reply_to: r.reply_to || undefined,
          }))
      );
    };

    const openChannel = async () => {
      const { supabase } = await import("@/integrations/supabase/client");
      if (channel) {
        supabase.removeChannel(channel);
        channel = null;
      }
      if (!alive) return;
      channel = supabase
        .channel(`tv_chat_${programaId}_${Date.now()}`)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "tv_chat_messages", filter: `programa_id=eq.${programaId}` },
          (payload: any) => {
            const r = payload.new;
            setMessages((prev) => {
              if (prev.some((m) => m.id === r.id)) return prev;
              return [
                ...prev,
                {
                  id: r.id,
                  user: r.user_name,
                  userId: r.user_id || undefined,
                  userPhoto: r.user_photo || undefined,
                  text: r.text,
                  ts: new Date(r.created_at).getTime(),
                  color: colorFor(r.user_name),
                  reply_to: r.reply_to || undefined,
                },
              ];
            });
          }
        )
        .subscribe();
    };

    setMessages([]);
    fetchHistory();
    openChannel();

    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      fetchHistory();
      openChannel();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", onVisible);
      (async () => {
        if (!channel) return;
        const { supabase } = await import("@/integrations/supabase/client");
        supabase.removeChannel(channel);
      })();
    };
  }, [programaId]);

  // auto-scroll
  useEffect(() => {
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const startReply = (m: ChatMessage) => {
    setReplyTo(m);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const sendRaw = async (rawText: string) => {
    const payload = {
      programa_id: programaId,
      user_name: displayName.slice(0, 60),
      user_id: myId || null,
      user_photo: myPhoto || null,
      text: rawText.slice(0, 500),
      reply_to: replyTo ? { id: replyTo.id, user: replyTo.user, text: replyTo.text.slice(0, 80) } : null,
    };
    setReplyTo(null);

    // Mostra a mensagem na hora (otimista), sem esperar o round-trip do
    // realtime — antes disso, se o canal tivesse caído em silêncio (ex:
    // celular em segundo plano durante o show), o remetente nunca via a
    // própria mensagem aparecer, achava que não tinha ido e digitava tudo
    // de novo (causa raiz do "mensagem sumiu"/"travou" relatado ontem).
    const tempId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setMessages((prev) => [
      ...prev,
      {
        id: tempId,
        user: payload.user_name,
        userId: payload.user_id || undefined,
        userPhoto: payload.user_photo || undefined,
        text: payload.text,
        ts: Date.now(),
        color: colorFor(payload.user_name),
        reply_to: payload.reply_to || undefined,
        pending: true,
      },
    ]);

    const { supabase } = await import("@/integrations/supabase/client");
    const { data, error } = await supabase
      .from("tv_chat_messages")
      .insert(payload)
      .select("id,created_at")
      .single();

    if (error || !data) {
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      throw error || new Error("Falha ao enviar mensagem.");
    }

    // Troca o id temporário pelo definitivo assim que o servidor confirma —
    // se o evento realtime da própria mensagem já tiver chegado antes (com
    // o id real), só descarta a bolha otimista em vez de duplicar.
    setMessages((prev) => {
      const jaChegouPeloRealtime = prev.some((m) => m.id === data.id && m.id !== tempId);
      if (jaChegouPeloRealtime) return prev.filter((m) => m.id !== tempId);
      return prev.map((m) =>
        m.id === tempId ? { ...m, id: data.id, ts: new Date(data.created_at).getTime(), pending: false } : m,
      );
    });
  };

  const send = async () => {
    const t = text.trim();
    if (!t || sending) return;
    setSending(true);
    setText("");
    try {
      await sendRaw(t);
    } catch {
      // restaura texto se falhar
      setText(t);
    } finally {
      setSending(false);
    }
  };

  const openGifPicker = async () => {
    setGifPickerOpen(true);
    if (gifs !== null) return;
    try {
      const res = await fetch("/api/empire-tv/gifs");
      const json = await res.json().catch(() => null);
      setGifs(Array.isArray(json?.data) ? json.data : []);
    } catch {
      setGifs([]);
    }
  };

  const sendGif = async (url: string, isVideo?: boolean) => {
    setGifPickerOpen(false);
    setSending(true);
    try {
      await sendRaw(`${isVideo ? VIDEO_GIF_PREFIX : GIF_PREFIX}${url}`);
    } finally {
      setSending(false);
    }
  };

  const uploadGif = async (file: File) => {
    if (uploadingGif) return;
    setUploadingGif(true);
    try {
      const isVideo = file.type.startsWith("video/");
      const base64Data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const res = await fetch("/api/gestao/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName: file.name,
          mimeType: file.type || "image/gif",
          base64Data,
          folderType: "tvChatGifs",
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || json?.success === false) {
        console.error("[uploadGif] Falha no upload:", json?.error || res.status);
        return;
      }
      const driveUrl = json?.data?.fileUrl;
      const match = typeof driveUrl === "string" ? driveUrl.match(/\/d\/([\w-]+)/) : null;
      // Proxy autenticado (não o link direto do Drive, que não é hotlinkável
      // e faz o GIF aparecer como link quebrado pra alguns jogadores).
      const thumbUrl = match ? `/api/media/image?id=${match[1]}` : driveUrl;
      if (thumbUrl) {
        setGifs((prev) => [
          { id: match?.[1] || String(Date.now()), name: file.name, url: thumbUrl, isVideo },
          ...(prev || []),
        ]);
        await sendGif(thumbUrl, isVideo);
      }
    } catch (err) {
      console.error("[uploadGif] Erro:", err);
    } finally {
      setUploadingGif(false);
    }
  };

  // Envolve o texto selecionado no campo com o marcador de formatação
  // (*negrito* / _itálico_) — se nada estiver selecionado, insere o par de
  // marcadores no cursor pra o jogador digitar entre eles.
  const wrapSelection = (marker: string) => {
    const el = inputRef.current;
    if (!el) return;
    const start = el.selectionStart ?? text.length;
    const end = el.selectionEnd ?? text.length;
    const before = text.slice(0, start);
    const middle = text.slice(start, end);
    const after = text.slice(end);
    const next = `${before}${marker}${middle}${marker}${after}`;
    setText(next);
    setTimeout(() => {
      el.focus();
      const cursor = middle ? start + marker.length + middle.length + marker.length : start + marker.length;
      el.setSelectionRange(cursor, cursor);
    }, 0);
  };

  const scrollToMsg = (id: string) => {
    const el = document.getElementById(`tvmsg-${id}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("ring-1", "ring-primary");
      setTimeout(() => el.classList.remove("ring-1", "ring-primary"), 1200);
    }
  };

  return (
    // Tudo (mensagens + campo de digitar) vive dentro do MESMO container
    // rolável. Isso é o que faz o teclado do celular se comportar direito:
    // o navegador só consegue rolar internamente pra revelar o campo em
    // vez de arrastar a tela inteira (e o vídeo) quando o campo focado
    // fica fora de qualquer ancestral rolável.
    <div ref={scrollerRef} className="flex-1 overflow-y-auto min-h-0 flex flex-col">
      <div className="flex-1 px-3 py-3 space-y-2 text-sm">
        {messages.length === 0 ? (
          <div className="h-full flex items-center justify-center text-muted-foreground text-xs text-center px-6">
            Seja o primeiro a comentar.
          </div>
        ) : (
          messages.map((m) => {
            // Aviso de chegada no Red Carpet — pill centralizada e clicável
            // que leva direto ao look publicado, em vez de bolha de chat comum.
            if (m.text.startsWith(RC_ARRIVAL_PREFIX)) {
              const partes = m.text.slice(RC_ARRIVAL_PREFIX.length).split("::");
              const [postId, nomeArtista, nomePrograma] = [partes[0] || "", partes[1] || m.user, partes[2] || ""];
              return (
                <div key={m.id} className="flex justify-center py-1">
                  <button
                    type="button"
                    onClick={() => onOpenRedCarpetPost(postId)}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-fuchsia-500/10 border border-fuchsia-500/30 text-[11px] font-semibold text-fuchsia-300 hover:bg-fuchsia-500/20 active:scale-95 transition"
                  >
                    <Sparkles className="size-3" />
                    <span className="text-foreground">{nomeArtista}</span> chegou ao{nomePrograma ? ` ${nomePrograma}` : " Programa"}
                  </button>
                </div>
              );
            }
            const own = myId ? m.userId === myId : m.user === displayName;
            return (
              <div
                key={m.id}
                id={`tvmsg-${m.id}`}
                className={`group flex items-end gap-2 rounded-lg px-1 py-0.5 -mx-1 ${own ? "flex-row-reverse" : ""} ${m.pending ? "opacity-50" : ""}`}
              >
                {!own && (
                  <div className="size-7 rounded-full overflow-hidden shrink-0 bg-muted grid place-items-center mb-0.5">
                    {m.userPhoto ? (
                      <img src={driveRawImg(m.userPhoto)} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                    ) : (
                      <span className={`text-[10px] font-black ${m.color}`}>{m.user.slice(0, 1).toUpperCase()}</span>
                    )}
                  </div>
                )}

                <div className={`max-w-[78%] flex flex-col ${own ? "items-end" : "items-start"}`}>
                  {m.reply_to && (
                    <button
                      type="button"
                      onClick={() => scrollToMsg(m.reply_to!.id)}
                      className={`block w-full text-left mb-1 pl-2 py-1 border-l-2 border-primary/60 text-[11px] rounded-r bg-black/10 hover:bg-black/20 transition-colors ${own ? "text-right border-l-0 border-r-2 pr-2 pl-0" : ""}`}
                    >
                      <span className="font-semibold text-primary/80">{m.reply_to.user}</span>
                      <span className="text-muted-foreground">: {m.reply_to.text.startsWith(GIF_PREFIX) || m.reply_to.text.startsWith(VIDEO_GIF_PREFIX) ? "GIF/figurinha" : m.reply_to.text}</span>
                    </button>
                  )}
                  {m.text.startsWith(GIF_PREFIX) || m.text.startsWith(VIDEO_GIF_PREFIX) ? (
                    <div className={`rounded-2xl overflow-hidden ${own ? "rounded-br-sm" : "rounded-bl-sm"} max-w-[180px]`}>
                      {!own && (
                        <span className={`block text-[11px] font-bold px-2 pt-1 bg-muted ${m.color}`}>{m.user}</span>
                      )}
                      {m.text.startsWith(VIDEO_GIF_PREFIX) ? (
                        <video
                          src={m.text.slice(VIDEO_GIF_PREFIX.length)}
                          autoPlay
                          muted
                          loop
                          playsInline
                          className="w-full h-auto block"
                        />
                      ) : (
                        <img
                          src={m.text.slice(GIF_PREFIX.length)}
                          alt="GIF"
                          loading="lazy"
                          referrerPolicy="no-referrer"
                          className="w-full h-auto block"
                        />
                      )}
                    </div>
                  ) : (
                    <div
                      className={`relative rounded-2xl px-3 py-1.5 leading-snug break-words ${
                        own
                          ? "bg-primary text-primary-foreground rounded-br-sm"
                          : "bg-muted text-foreground rounded-bl-sm"
                      }`}
                    >
                      {!own && <span className={`block text-[11px] font-bold ${m.color}`}>{m.user}</span>}
                      <span>{renderFormattedText(m.text)}</span>
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => startReply(m)}
                  className="mb-1 size-7 grid place-items-center rounded-full opacity-70 active:opacity-100 active:bg-muted lg:opacity-0 lg:group-hover:opacity-100 text-muted-foreground hover:text-primary transition shrink-0"
                  aria-label="Responder"
                >
                  <Reply className="inline size-3.5" />
                </button>
              </div>
            );
          })
        )}
      </div>

      {/* Grudado no fundo do MESMO scroller das mensagens (não fora dele) —
          é isso que dá ao Safari um ancestral rolável válido pra revelar o
          campo sem precisar deslizar a página/vídeo inteiros. */}
      <div className="sticky bottom-0 bg-background">
      {replyTo && (
        <div className="flex items-start gap-2 px-3 py-1.5 border-t border-border bg-muted/40 text-[11px]">
          <Reply className="size-3 mt-0.5 text-primary shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-muted-foreground">Respondendo a <span className={`font-semibold ${colorFor(replyTo.user)}`}>{replyTo.user}</span></div>
            <div className="truncate text-foreground/80">{replyTo.text.startsWith(GIF_PREFIX) || replyTo.text.startsWith(VIDEO_GIF_PREFIX) ? "GIF/figurinha" : replyTo.text}</div>
          </div>
          <button type="button" onClick={() => setReplyTo(null)} className="shrink-0 hover:text-foreground text-muted-foreground" aria-label="Cancelar resposta">
            <X className="size-3.5" />
          </button>
        </div>
      )}

      {gifPickerOpen && (
        <div className="border-t border-border bg-background/95 p-2 max-h-52 overflow-y-auto">
          <div className="flex items-center justify-between px-1 pb-2">
            <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
              GIFs e stickers — de todo mundo
            </span>
            <button type="button" onClick={() => setGifPickerOpen(false)} className="text-muted-foreground hover:text-foreground" aria-label="Fechar">
              <X className="size-3.5" />
            </button>
          </div>
          <div className="grid grid-cols-4 gap-1.5">
            <button
              type="button"
              onClick={() => gifFileRef.current?.click()}
              disabled={uploadingGif}
              className="aspect-square rounded-md border border-dashed border-border flex flex-col items-center justify-center gap-1 text-muted-foreground hover:text-primary hover:border-primary/50 transition disabled:opacity-50"
              title="Enviar novo GIF/sticker (fica disponível pra todo mundo)"
            >
              {uploadingGif ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
              <span className="text-[9px] font-semibold">Enviar</span>
            </button>
            <input
              ref={gifFileRef}
              type="file"
              accept="image/gif,image/png,image/jpeg,image/webp,video/mp4,video/quicktime,video/webm"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) uploadGif(file);
                e.target.value = "";
              }}
            />
            {gifs === null ? (
              <div className="col-span-3 flex items-center justify-center text-xs text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
              </div>
            ) : gifs.length === 0 ? (
              <div className="col-span-3 flex items-center text-[11px] text-muted-foreground px-2">
                Nenhum GIF enviado ainda — seja o primeiro.
              </div>
            ) : (
              gifs.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => sendGif(g.url, g.isVideo)}
                  className="aspect-square rounded-md overflow-hidden bg-muted hover:ring-2 hover:ring-primary transition"
                  title={g.name}
                >
                  {g.isVideo ? (
                    <video src={g.url} muted loop playsInline className="w-full h-full object-cover" />
                  ) : (
                    <img src={g.url} alt={g.name} loading="lazy" referrerPolicy="no-referrer" className="w-full h-full object-cover" />
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}

      <form
        onSubmit={(e) => { e.preventDefault(); send(); }}
        className="flex items-center gap-1.5 px-3 py-2 border-t border-border bg-background"
      >
        <button
          type="button"
          onClick={() => wrapSelection("*")}
          title="Negrito (*texto*)"
          className="size-8 shrink-0 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted font-black text-sm grid place-items-center"
        >
          B
        </button>
        <button
          type="button"
          onClick={() => wrapSelection("_")}
          title="Itálico (_texto_)"
          className="size-8 shrink-0 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted italic font-bold text-sm grid place-items-center"
        >
          I
        </button>
        <button
          type="button"
          onClick={() => (gifPickerOpen ? setGifPickerOpen(false) : openGifPicker())}
          title="GIF / sticker"
          className={`size-8 shrink-0 rounded-md grid place-items-center transition ${gifPickerOpen ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-muted"}`}
        >
          <ImagePlus className="size-4" />
        </button>
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={replyTo ? `Responder a ${replyTo.user}...` : "Mandar mensagem"}
          maxLength={300}
          className="flex-1 h-9 px-3 rounded-md bg-muted text-base outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground min-w-0"
        />
        <button
          type="submit"
          disabled={!text.trim()}
          className="h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-semibold flex items-center gap-1 disabled:opacity-40 shrink-0"
        >
          <Send className="size-4" />
        </button>
      </form>
      </div>
    </div>
  );
}

// ---------- Red Carpet ----------
function RedCarpetCarousel({ fotos }: { fotos: string[] }) {
  const [idx, setIdx] = useState(0);
  if (fotos.length === 0) return null;
  const go = (delta: number) => setIdx((i) => Math.max(0, Math.min(fotos.length - 1, i + delta)));
  return (
    <div className="relative aspect-[4/5] bg-black">
      {/* Foto como background-image (não <img>) — evita o selo nativo
          "Visual Look Up" que o Safari/iOS sobrepõe automaticamente em
          <img> com uma pessoa/objeto reconhecível na cena. */}
      <div
        role="img"
        aria-label={`Foto do look de ${idx + 1} de ${fotos.length}`}
        className="w-full h-full bg-center bg-cover"
        style={{ backgroundImage: `url(${driveRawImg(fotos[idx])})` }}
      />
      {fotos.length > 1 && (
        <>
          {idx > 0 && (
            <button
              type="button"
              onClick={() => go(-1)}
              className="absolute left-2 top-1/2 -translate-y-1/2 size-7 rounded-full bg-black/45 backdrop-blur grid place-items-center text-white"
              aria-label="Foto anterior"
            >
              <ChevronLeft className="size-4" />
            </button>
          )}
          {idx < fotos.length - 1 && (
            <button
              type="button"
              onClick={() => go(1)}
              className="absolute right-2 top-1/2 -translate-y-1/2 size-7 rounded-full bg-black/45 backdrop-blur grid place-items-center text-white"
              aria-label="Próxima foto"
            >
              <ChevronRight className="size-4" />
            </button>
          )}
          <div className="absolute bottom-2.5 left-0 right-0 flex justify-center gap-1">
            {fotos.map((_, i) => (
              <span key={i} className={`h-1 rounded-full transition-all ${i === idx ? "w-3.5 bg-white" : "w-1 bg-white/40"}`} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function RedCarpetComposer({
  programa,
  artists,
  onClose,
  onPosted,
}: {
  programa: Programa;
  artists: Artist[];
  onClose: () => void;
  onPosted: (post: RedCarpetPost) => void;
}) {
  const login = getStoredLogin();
  const [artista, setArtista] = useState<Artist | null>(artists[0] || null);
  const [fotos, setFotos] = useState<string[]>([]);
  const [legenda, setLegenda] = useState("");
  const [uploading, setUploading] = useState(false);
  const [posting, setPosting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const addFotos = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const restantes = Math.max(0, 4 - fotos.length);
    const escolhidas = Array.from(files).slice(0, restantes);
    if (escolhidas.length === 0) return;
    setUploading(true);
    try {
      for (const file of escolhidas) {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("fileName", file.name);
        formData.append("folderType", "redCarpet");
        const res = await fetch("/api/gestao/upload", { method: "POST", body: formData });
        const data = await res.json().catch(() => null);
        if (res.ok && data?.success && data?.data?.fileUrl) {
          setFotos((prev) => [...prev, data.data.fileUrl as string]);
        }
      }
    } catch (err) {
      console.error("[RedCarpetComposer] Erro no upload:", err);
    } finally {
      setUploading(false);
    }
  };

  const publicar = async () => {
    if (!artista || fotos.length === 0 || posting) return;
    setPosting(true);
    try {
      const res = await api.postarRedCarpet({
        programaId: programa.id,
        artista: artista.nome,
        artistaFoto: artista.foto,
        fotos,
        legenda: legenda.trim(),
        telegramId: login?.id || "",
      });
      if (res.success && res.data) {
        sendRedCarpetArrivalMessage(programa.id, res.data.id, artista.nome, programa.titulo, artista.foto);
        onPosted(res.data);
      } else {
        alert(res.error || "Não deu pra publicar. Tente de novo.");
      }
    } finally {
      setPosting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col" style={{ paddingTop: "env(safe-area-inset-top)" }}>
      <div className="flex items-center gap-2 px-3 h-12 border-b border-border shrink-0">
        <button onClick={onClose} className="size-8 rounded-full hover:bg-muted flex items-center justify-center" aria-label="Fechar">
          <X className="size-4" />
        </button>
        <div className="flex-1 text-sm font-bold">Postar no Red Carpet</div>
        <button
          onClick={publicar}
          disabled={!artista || fotos.length === 0 || posting}
          className="px-3.5 h-8 rounded-full bg-gradient-to-br from-primary via-primary to-fuchsia-500/80 text-primary-foreground text-xs font-bold disabled:opacity-40 flex items-center gap-1.5"
        >
          {posting ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
          Publicar
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {artists.length > 1 && (
          <div>
            <div className="text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground mb-2">Postando como</div>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {artists.map((a) => (
                <button
                  key={a.nome}
                  onClick={() => setArtista(a)}
                  className={`flex items-center gap-2 pl-1 pr-3 h-9 rounded-full border shrink-0 ${
                    artista?.nome === a.nome ? "border-primary bg-primary/10" : "border-border"
                  }`}
                >
                  <div className="size-7 rounded-full overflow-hidden bg-muted shrink-0">
                    {a.foto && <img src={driveRawImg(a.foto)} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />}
                  </div>
                  <span className="text-xs font-semibold">{a.nome}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div>
          <div className="text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground mb-2">Fotos (até 4)</div>
          <div className="grid grid-cols-4 gap-2">
            {fotos.map((f, i) => (
              <div key={i} className="relative aspect-square rounded-lg overflow-hidden bg-muted">
                <img src={driveRawImg(f)} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                <button
                  type="button"
                  onClick={() => setFotos((prev) => prev.filter((_, idx) => idx !== i))}
                  className="absolute top-1 right-1 size-5 rounded-full bg-black/70 grid place-items-center"
                  aria-label="Remover foto"
                >
                  <X className="size-3 text-white" />
                </button>
              </div>
            ))}
            {fotos.length < 4 && (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="aspect-square rounded-lg border-2 border-dashed border-border grid place-items-center text-muted-foreground disabled:opacity-50"
              >
                {uploading ? <Loader2 className="size-5 animate-spin" /> : <Camera className="size-5" />}
              </button>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => addFotos(e.target.files)}
          />
        </div>

        <div>
          <div className="text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground mb-2">Legenda</div>
          <textarea
            value={legenda}
            onChange={(e) => setLegenda(e.target.value)}
            placeholder="Escreva uma legenda para o tapete vermelho..."
            className="w-full h-20 resize-none rounded-xl border border-border bg-muted/30 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
            maxLength={280}
          />
        </div>
      </div>
    </div>
  );
}

function RedCarpetPanel({
  programa,
  highlightPostId,
  onHighlightConsumed,
}: {
  programa: Programa;
  highlightPostId: string | null;
  onHighlightConsumed: () => void;
}) {
  const login = getStoredLogin();
  const [posts, setPosts] = useState<RedCarpetPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [myArtists, setMyArtists] = useState<Artist[]>([]);
  const [composerOpen, setComposerOpen] = useState(false);
  const [likedLocally, setLikedLocally] = useState<Set<string>>(new Set());
  const postRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [view, setView] = useState<"feed" | "ranking">("feed");
  const [ranking, setRanking] = useState<RedCarpetPost[]>([]);
  const [rankingLoading, setRankingLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    const data = await api.listarRedCarpet(programa.id);
    setPosts(data);
    setLoading(false);
  };

  useEffect(() => {
    load();
    if (login?.id) api.meusArtistas(login.id).then(setMyArtists);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [programa.id]);

  useEffect(() => {
    if (!highlightPostId || posts.length === 0) return;
    const el = postRefs.current[highlightPostId];
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("ring-2", "ring-fuchsia-500");
      setTimeout(() => el.classList.remove("ring-2", "ring-fuchsia-500"), 1600);
    }
    onHighlightConsumed();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightPostId, posts]);

  useEffect(() => {
    if (view !== "ranking") return;
    setRankingLoading(true);
    api.rankingRedCarpet(programa.id).then((data) => {
      setRanking(data);
      setRankingLoading(false);
    });
  }, [view, programa.id]);

  const curtir = async (post: RedCarpetPost) => {
    if (likedLocally.has(post.id) || post.telegramId === login?.id) return;
    setLikedLocally((prev) => new Set(prev).add(post.id));
    setPosts((prev) => prev.map((p) => (p.id === post.id ? { ...p, likes: p.likes + 1 } : p)));
    const res = await api.curtirRedCarpet(post.id, login?.id || "");
    if (!res.success) {
      // Reverte se o backend recusou (ex: tentou curtir o próprio look).
      setLikedLocally((prev) => {
        const next = new Set(prev);
        next.delete(post.id);
        return next;
      });
      setPosts((prev) => prev.map((p) => (p.id === post.id ? { ...p, likes: Math.max(0, p.likes - 1) } : p)));
    }
  };

  const excluir = async (post: RedCarpetPost) => {
    if (!login?.id || post.telegramId !== login.id) return;
    if (!confirm("Excluir essa publicação do Red Carpet?")) return;
    setPosts((prev) => prev.filter((p) => p.id !== post.id));
    await api.deletarRedCarpet(post.id, login.id);
  };

  // Artistas distintos que já postaram nesta sala — rail no topo, igual ao
  // menu Social. "Você" sempre aparece primeiro pra abrir o composer.
  const artistasNoFeed = Array.from(new Map(posts.map((p) => [p.artista, p.artistaFoto])).entries());

  return (
    <div className="flex-1 overflow-y-auto min-h-0">
      <div className="flex items-center gap-1.5 px-3 pt-3">
        <button
          type="button"
          onClick={() => setView("feed")}
          className={`h-7 px-3 rounded-full text-[11px] font-bold transition ${
            view === "feed" ? "bg-gradient-to-br from-primary via-primary to-fuchsia-500/80 text-primary-foreground" : "text-muted-foreground border border-border"
          }`}
        >
          Feed
        </button>
        <button
          type="button"
          onClick={() => setView("ranking")}
          className={`h-7 px-3 rounded-full text-[11px] font-bold transition flex items-center gap-1 ${
            view === "ranking" ? "bg-gradient-to-br from-primary via-primary to-fuchsia-500/80 text-primary-foreground" : "text-muted-foreground border border-border"
          }`}
        >
          🏆 Ranking
        </button>
      </div>

      {view === "ranking" ? (
        <div className="px-3 py-3">
          <div className="mb-3 px-3 py-2.5 rounded-xl bg-fuchsia-500/10 border border-fuchsia-500/25 text-[11px] text-fuchsia-300">
            Ranking dos looks mais curtidos nesta sala — base do prêmio <b className="text-foreground">Gary Lake Fashion Carpet</b>.
          </div>
          {rankingLoading ? (
            <div className="py-8 text-center text-xs text-muted-foreground">Carregando ranking...</div>
          ) : ranking.length === 0 ? (
            <div className="py-8 text-center text-xs text-muted-foreground">Nenhum look curtido ainda.</div>
          ) : (
            <div className="space-y-2">
              {ranking.map((post, i) => (
                <div key={post.id} className="flex items-center gap-3 rounded-xl border border-border bg-card p-2">
                  <div className="w-6 text-center font-mono text-xs font-bold text-muted-foreground shrink-0">
                    {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : i + 1}
                  </div>
                  <div className="size-12 rounded-lg overflow-hidden bg-muted shrink-0">
                    {post.fotos[0] && (
                      <div
                        role="img"
                        aria-label={`Look de ${post.artista}`}
                        className="w-full h-full bg-center bg-cover"
                        style={{ backgroundImage: `url(${driveRawImg(post.fotos[0])})` }}
                      />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-bold truncate">{post.artista}</div>
                    {post.legenda && <div className="text-[10.5px] text-muted-foreground truncate">{post.legenda}</div>}
                  </div>
                  <div className="flex items-center gap-1 text-fuchsia-400 shrink-0">
                    <Heart className="size-3.5 fill-fuchsia-400" />
                    <span className="text-xs font-mono font-bold">{post.likes}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <>
      <div className="flex gap-3 px-3 py-3 overflow-x-auto">
        <button
          type="button"
          onClick={() => setComposerOpen(true)}
          disabled={myArtists.length === 0}
          className="flex flex-col items-center gap-1 w-14 shrink-0 disabled:opacity-40"
        >
          <div className="size-12 rounded-full border-2 border-dashed border-primary/50 grid place-items-center text-primary">
            <Plus className="size-5" />
          </div>
          <span className="text-[9.5px] text-muted-foreground truncate w-full text-center">Você</span>
        </button>
        {artistasNoFeed.map(([nome, foto]) => (
          <div key={nome} className="flex flex-col items-center gap-1 w-14 shrink-0">
            <div className="size-12 rounded-full p-0.5 bg-gradient-to-br from-primary via-primary to-fuchsia-500/80">
              <div className="size-full rounded-full overflow-hidden bg-muted border-2 border-background">
                {foto && <img src={driveRawImg(foto)} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />}
              </div>
            </div>
            <span className="text-[9.5px] text-muted-foreground truncate w-full text-center">{nome}</span>
          </div>
        ))}
      </div>

      {myArtists.length === 0 && (
        <div className="mx-3 mb-3 px-3 py-2 rounded-lg bg-muted/40 text-[11px] text-muted-foreground">
          Você precisa ter um artista pra postar no Red Carpet.
        </div>
      )}

      {loading ? (
        <div className="px-3 py-8 text-center text-xs text-muted-foreground">Carregando o tapete vermelho...</div>
      ) : posts.length === 0 ? (
        <div className="px-3 py-10 text-center text-xs text-muted-foreground">
          Ninguém chegou ao Red Carpet ainda. Seja o primeiro a postar seu look.
        </div>
      ) : (
        <div className="px-3 pb-4 space-y-3">
          {posts.map((post) => (
            <div
              key={post.id}
              ref={(el) => { postRefs.current[post.id] = el; }}
              className="rounded-2xl overflow-hidden border border-border bg-card transition-shadow"
            >
              <div className="flex items-center gap-2 px-3 py-2.5">
                <div className="size-8 rounded-full overflow-hidden bg-muted shrink-0">
                  {post.artistaFoto && (
                    <img src={driveRawImg(post.artistaFoto)} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-bold truncate">{post.artista}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {new Date(post.data).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                  </div>
                </div>
                {post.telegramId === login?.id && (
                  <button
                    type="button"
                    onClick={() => excluir(post)}
                    className="size-7 rounded-full grid place-items-center text-muted-foreground hover:text-red-400 active:scale-90 transition shrink-0"
                    aria-label="Excluir publicação"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                )}
              </div>

              <RedCarpetCarousel fotos={post.fotos} />

              <div className="flex items-center gap-1.5 px-3 pt-2 text-muted-foreground">
                {post.telegramId === login?.id ? (
                  <Heart className="size-[18px] opacity-30" />
                ) : (
                  <button
                    type="button"
                    onClick={() => curtir(post)}
                    className={`flex items-center gap-1 active:scale-90 transition ${likedLocally.has(post.id) ? "text-fuchsia-500" : ""}`}
                    aria-label="Curtir look"
                  >
                    <Heart className={`size-[18px] ${likedLocally.has(post.id) ? "fill-fuchsia-500" : ""}`} />
                  </button>
                )}
                <span className="text-[11px] font-mono">{post.likes}</span>
              </div>

              {post.legenda && (
                <div className="px-3 pt-1 pb-3 text-xs">
                  <span className="font-bold mr-1">{post.artista}</span>
                  {post.legenda}
                </div>
              )}
              {!post.legenda && <div className="pb-2" />}
            </div>
          ))}
        </div>
      )}
        </>
      )}

      {composerOpen && (
        <RedCarpetComposer
          programa={programa}
          artists={myArtists}
          onClose={() => setComposerOpen(false)}
          onPosted={(post) => {
            setPosts((prev) => [post, ...prev]);
            setComposerOpen(false);
          }}
        />
      )}
    </div>
  );
}

// ---------- Participantes ----------
function ParticipantesPanel({ programa }: { programa: Programa }) {
  const [rows, setRows] = useState<Array<{ telegram_id: string; nome: string; watched_seconds: number; percentual: number }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    const load = () => {
      api.listarPresencaTV(programa.id)
        .then((r) => { if (alive) setRows(r); })
        .catch(() => {})
        .finally(() => { if (alive) setLoading(false); });
    };
    load();
    const t = setInterval(load, 30_000);
    return () => { alive = false; clearInterval(t); };
  }, [programa.id]);

  const sorted = useMemo(() => [...rows].sort((a, b) => b.watched_seconds - a.watched_seconds), [rows]);

  return (
    <div className="flex-1 overflow-y-auto p-3">
      {loading && rows.length === 0 ? (
        <div className="text-xs text-muted-foreground">Carregando...</div>
      ) : sorted.length === 0 ? (
        <div className="text-xs text-muted-foreground italic">Ninguém registrado ainda.</div>
      ) : (
        <ul className="space-y-1.5">
          {sorted.map((p) => (
            <li key={p.telegram_id} className="flex items-center justify-between text-sm">
              <span className={`font-semibold truncate ${colorFor(p.nome)}`}>{p.nome}</span>
              <span className="text-xs text-muted-foreground shrink-0 ml-2">
                {p.percentual > 0 ? `${p.percentual.toFixed(0)}%` : fmtMin(p.watched_seconds)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function fmtMin(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}min` : `${s}s`;
}

// ---------- Sobre ----------
function SobrePanel({ programa }: { programa: Programa }) {
  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-3 text-sm">
      <h3 className="text-base font-bold">{programa.titulo}</h3>
      {programa.categoria && (
        <div className="text-xs uppercase tracking-wider text-muted-foreground">{programa.categoria}</div>
      )}
      {programa.subtitulo && <p className="text-muted-foreground">{programa.subtitulo}</p>}
      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
        {programa.ao_vivo && (
          <span className="flex items-center gap-1 px-2 py-1 rounded bg-red-500/15 text-red-400 font-bold">
            <Radio className="size-3 animate-pulse" /> AO VIVO
          </span>
        )}
        {programa.data_inicio && (
          <span className="flex items-center gap-1 px-2 py-1 rounded bg-muted">
            <Calendar className="size-3" /> {programa.data_inicio}
          </span>
        )}
        {programa.buff && (
          <span className="px-2 py-1 rounded bg-muted">Buff: {programa.buff}</span>
        )}
      </div>
    </div>
  );
}

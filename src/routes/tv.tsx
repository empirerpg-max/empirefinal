import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Send, Radio, Users, Play, ArrowLeft, Calendar, MessageSquare, Info, Archive, ListVideo, Clock, X, Reply, Menu, ChevronLeft, ChevronRight, ImagePlus, Upload, Loader2, VolumeX, Volume2, Minimize2, Sparkles, Heart, Camera, Plus, Trash2, Star, Square, ShieldCheck, Copy } from "lucide-react";
import logoIcon from "@/assets/logo-icon.png";
import { api, driveImg, driveRawImg, resolveImg, type ProgramaTV, type Artist, type RedCarpetPost, type EnquetePayload } from "@/lib/api";
import { SmartImg } from "@/components/SmartImg";
import { getKickStatus } from "@/lib/kick.functions";
import { getStoredLogin, isAdminLogin } from "@/components/LoginScreen";
import { useTelegramUser } from "@/lib/telegram";
import { useImageCrop } from "@/hooks/use-image-crop";
import { useTvPlayer } from "@/components/EmpireTV/TvPlayerContext";
import { resolveStreamEmbed, kickChannelFromUrl, forceUnmuteIframe, hasUnmutedThisSession } from "@/lib/tvEmbed";
import { estaNoFim, pertoDoTopo, decidirAoChegar } from "@/lib/tvChatRolagem";
import { useArrastarParaResponder } from "@/hooks/useArrastarParaResponder";
import { useDragScroll } from "@/hooks/useDragScroll";
import { StickyScrollArrowLeft, StickyScrollArrowRight } from "@/components/StickyScrollArrows";
import { marcarSalaAtiva, salaDaUrl } from "@/lib/salaAtiva";


export const Route = createFileRoute("/tv")({
  head: () => ({
    meta: [
      { title: "Empire TV" },
      { name: "description", content: "Empire TV — transmissões ao vivo do Empire." },
    ],
  }),
  // `?sala={id}`: a sala aberta fica no endereço, então qualquer recarga
  // (atualização ou o navegador esvaziando a aba por memória) volta direto
  // pra mesma sala em vez de cair no menu. O roteador lê `?sala=123` como
  // número (JSON), por isso aceita os dois.
  validateSearch: (search: Record<string, unknown>): { sala?: string } => {
    const v = search.sala;
    if (typeof v === "number" && Number.isFinite(v)) return { sala: String(v) };
    if (typeof v === "string" && v.trim()) return { sala: v.trim() };
    return {};
  },
  component: TvPage,
});

// Entrada da sala no histórico: `?sala={id}` + a marca `tvSala` no state.
// Entrar pelo menu EMPURRA essa entrada (voltar fecha a sala e mostra o
// menu); vindo do mini player de outra tela, ela SUBSTITUI a entrada /tv
// recém-aberta. As marcas do modo deitado (B4) e do menu da mensagem (B3)
// são empurradas por cima dela com o mesmo endereço.
function urlComSala(id: string | null): string {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set("sala", id);
  else url.searchParams.delete("sala");
  return url.pathname + url.search + url.hash;
}

function empurrarEntradaDaSala(id: string) {
  const atual = window.history.state ?? {};
  const idx = typeof atual.__TSR_index === "number" ? atual.__TSR_index + 1 : 1;
  const key = Math.random().toString(36).slice(2, 10);
  // Chaves do roteador junto: sem elas o TanStack reescreve o state numa
  // recarga e a marca `tvSala` se perderia.
  window.history.pushState({ __TSR_index: idx, key, __TSR_key: key, tvSala: id }, "", urlComSala(id));
}

// Troca só o `?sala=` (e a marca) da entrada ATUAL, mantendo o resto do
// state. O roteador escuta pushState/replaceState, então useSearch acompanha.
function trocarSalaNaUrl(id: string | null) {
  if (typeof window === "undefined") return;
  const st = { ...(window.history.state ?? {}) };
  if (id) st.tvSala = id;
  else delete st.tvSala;
  window.history.replaceState(st, "", urlComSala(id));
}

function entradaDeOverlayDaSala(): boolean {
  const st = typeof window !== "undefined" ? window.history.state : null;
  return !!(st?.tvSalaDeitada || st?.tvChatMenu);
}

// Tira as entradas do modo deitado / menu da mensagem que estejam por cima
// da entrada da sala (cada uma fecha no próprio popstate) e só então segue.
function voltarAteEntradaDaSala(depois: () => void) {
  if (!entradaDeOverlayDaSala()) {
    depois();
    return;
  }
  const onPop = () => {
    window.removeEventListener("popstate", onPop);
    voltarAteEntradaDaSala(depois);
  };
  window.addEventListener("popstate", onPop);
  window.history.back();
}



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

// Teto de mensagens buscadas no histórico inicial e mantidas na lista ao
// vivo do Chat — sem isso, uma sala com muito fluxo (principalmente com
// GIFs em vídeo, que cada um vira um <video> decodificando e tocando em
// loop) acumulava centenas de nós no DOM até travar o app/esquentar o
// aparelho. Ver LazyGifVideo abaixo pra mitigação complementar.
const CHAT_HISTORY_LIMIT = 150;
const MAX_LIVE_MESSAGES = 150;

// Vídeo-GIF que só decodifica/toca quando está perto/dentro da tela —
// antes, TODO vídeo da lista tinha autoPlay+loop incondicional, então uma
// sala com vários GIFs em vídeo mantinha dezenas deles tocando ao mesmo
// tempo, sobrecarregando o aparelho. Fora da tela, além de pausar, SOLTA o
// `src` (removeAttribute + load) pra liberar o vídeo decodificado da
// memória — no iPhone a aba da transmissão era descartada pelo navegador
// (tela cinza/preta) com o iframe da Kick + chat cheio de GIFs. A altura
// atual fica travada enquanto está solto, pra lista não pular.
function LazyGifVideo({ src }: { src: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      el.src = src;
      el.play().catch(() => {});
      return;
    }
    const aoCarregar = () => {
      el.style.height = "";
    };
    el.addEventListener("loadeddata", aoCarregar);
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          if (el.getAttribute("src") !== src) el.src = src;
          el.play().catch(() => {});
        } else if (el.getAttribute("src")) {
          el.pause();
          const h = el.offsetHeight;
          if (h > 0) el.style.height = `${h}px`;
          el.removeAttribute("src");
          el.load();
        }
      },
      { rootMargin: "200px 0px" },
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
      el.removeEventListener("loadeddata", aoCarregar);
      el.pause();
      el.removeAttribute("src");
      el.load();
    };
  }, [src]);
  return <video ref={ref} muted loop playsInline preload="metadata" className="w-full h-auto block min-h-[96px]" />;
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
  const { sala } = Route.useSearch();
  const [programasRaw, setProgramasRaw] = useState<Programa[]>([]);
  const [loading, setLoading] = useState(true);
  // true depois da primeira resposta OK da grade (falha de rede não conta:
  // a sala pedida no endereço espera a próxima tentativa).
  const [gradeCarregada, setGradeCarregada] = useState(false);
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
        .then((list) => {
          if (!alive) return;
          setProgramasRaw(list);
          setGradeCarregada(true);
        })
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

  // ---- Sala no endereço (?sala={id}) ----
  const salaNaTela = watching && !floating ? String(watching.id) : null;
  const salaNaTelaRef = useRef(salaNaTela);
  salaNaTelaRef.current = salaNaTela;

  // Só a sala em tela cheia adia recargas automáticas (staleChunk/pwa). Com
  // só o mini player em outra tela, a recarga segue normal — uma tela
  // quebrada é pior que perder a miniatura.
  const salaAberta = salaNaTela != null;
  useEffect(() => {
    marcarSalaAtiva(salaAberta);
  }, [salaAberta]);
  useEffect(() => () => marcarSalaAtiva(false), []);

  // A sala apareceu e o endereço ainda não tem o id dela: entrou pelo menu
  // (ou expandiu o mini player aqui mesmo) → EMPURRA a entrada da sala;
  // chegou de outra tela com a sala já aberta (mini player expandido) →
  // SUBSTITUI a entrada /tv que acabou de abrir. Layout effect: roda antes
  // do WatchView empurrar a marca do modo deitado.
  const modoEntradaRef = useRef<"push" | "replace">(watching ? "replace" : "push");
  useLayoutEffect(() => {
    if (!salaNaTela) return;
    const modo = modoEntradaRef.current;
    modoEntradaRef.current = "push";
    if (salaDaUrl(window.location.search) === salaNaTela) return;
    if (modo === "push") empurrarEntradaDaSala(salaNaTela);
    else trocarSalaNaUrl(salaNaTela);
  }, [salaNaTela]);

  const abrirPeloId = (id: string): boolean => {
    if (watching && String(watching.id) === id) {
      restore();
      return true;
    }
    const p = programas.find((x) => String(x.id) === id);
    if (!p) return false;
    setWatching(p);
    return true;
  };
  const abrirPeloIdRef = useRef(abrirPeloId);
  abrirPeloIdRef.current = abrirPeloId;

  // Pedido vindo do endereço ao abrir a tela (ex.: depois de uma recarga):
  // entra direto nessa sala assim que a grade carrega, sem entrada nova; se
  // não achar, fica no menu e tira o parâmetro.
  const salaPedidaRef = useRef<string | null>(sala ?? null);
  useEffect(() => {
    const pedida = salaPedidaRef.current;
    if (!pedida || !gradeCarregada) return;
    salaPedidaRef.current = null;
    if (salaNaTela === pedida) return;
    if (!abrirPeloId(pedida) && !salaNaTela) trocarSalaNaUrl(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gradeCarregada, programas]);

  // Voltar/avançar do celular ou navegador:
  // - saiu da entrada da sala (endereço sem o id dela) → fecha a sala e o
  //   menu da Empire TV aparece;
  // - avançou de volta pra entrada de uma sala → reabre essa sala (a
  //   entrada já existe, nada é empurrado de novo).
  // As marcas do modo deitado/menu da mensagem têm o mesmo endereço da sala,
  // então voltar delas não fecha nada aqui (cada uma cuida da sua).
  useEffect(() => {
    const onPop = () => {
      if (window.location.pathname !== "/tv") return;
      if (entradaDeOverlayDaSala()) return;
      const naUrl = salaDaUrl(window.location.search);
      const naTela = salaNaTelaRef.current;
      if (naTela && naUrl !== naTela) {
        salaNaTelaRef.current = null;
        if (naUrl && abrirPeloIdRef.current(naUrl)) return;
        stopWatching();
        return;
      }
      if (!naTela && naUrl && !salaPedidaRef.current) {
        if (!abrirPeloIdRef.current(naUrl)) trocarSalaNaUrl(null);
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Seta/X da própria sala: volta no histórico se a entrada é a da sala
  // (igual ao voltar do celular); senão (ex.: link aberto direto) fecha e
  // troca o endereço pra /tv sem criar entrada.
  const sairDaSala = () => {
    voltarAteEntradaDaSala(() => {
      if (window.history.state?.tvSala) {
        window.history.back();
      } else {
        salaNaTelaRef.current = null;
        stopWatching();
        trocarSalaNaUrl(null);
      }
    });
  };

  // Minimizar continua mostrando o menu com o mini player; a entrada da
  // sala sai do histórico do mesmo jeito (voltar de novo não reabre nada).
  const minimizarSala = () => {
    voltarAteEntradaDaSala(() => {
      salaNaTelaRef.current = null;
      minimize();
      if (window.history.state?.tvSala) window.history.back();
      else trocarSalaNaUrl(null);
    });
  };

  return (
    <div
      className={`fixed inset-0 bg-background text-foreground overflow-hidden transition-all ${
        watching && !floating ? "z-[70]" : "top-[calc(4rem+env(safe-area-inset-top))] bottom-[calc(4rem+env(safe-area-inset-bottom))]"
      }`}
    >
      {watching && !floating ? (
        <WatchView programa={watching} onBack={sairDaSala} onMinimize={minimizarSala} />
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
// garantindo um único player montado por vez. Hoje a WatchView vai além:
// é UMA árvore só nos três modos (celular em pé, celular deitado, tela larga)
// e só as classes mudam — assim girar o celular não recria o iframe (a
// transmissão não recarrega nem volta a ficar muda).
function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(query);
    setMatches(mq.matches);
    const onChange = () => setMatches(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [query]);
  return matches;
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
  const tabBarScroll = useDragScroll<HTMLDivElement>();

  // Três modos de layout, decididos por media query (nada de API de rotação):
  // - "deitado": celular na horizontal — vídeo ocupa a tela e o chat vira uma
  //   coluna à direita (38%), sem abas;
  // - "largo": área com 760 px ou mais (tablet deitado, computador) — vídeo,
  //   faixa e abas à esquerda; chat fixo numa coluna à direita;
  // - celular em pé (padrão): vídeo 16:9 no topo, faixa fina, abas e chat.
  const deitadoMq = useMediaQuery("(orientation: landscape) and (max-height: 500px)");
  const largoMq = useMediaQuery("(min-width: 760px)");
  // Voltar do celular sai do modo deitado antes de sair da sala (regra
  // "voltar = tela anterior"): entrar nele empurra uma entrada própria no
  // histórico; o voltar a tira e a sala passa a mostrar o layout normal
  // mesmo com o celular ainda deitado, até ele ser girado de novo.
  const [deitadoDispensado, setDeitadoDispensado] = useState(false);
  useEffect(() => {
    if (!deitadoMq) setDeitadoDispensado(false);
  }, [deitadoMq]);
  const deitado = deitadoMq && !deitadoDispensado;
  const largo = largoMq && !deitado;
  useEffect(() => {
    if (!deitado) return;
    let ativo = true;
    let empurrado = false;
    const empurrar = () => {
      if (!ativo) return;
      window.history.pushState({ tvSalaDeitada: true }, "");
      empurrado = true;
    };
    // Girou com o menu de uma mensagem aberto: fecha o menu primeiro (tira a
    // entrada dele) e só então empurra a do modo deitado — assim não fica
    // entrada órfã do menu embaixo da nossa. O ChatPanel fecha o menu no
    // mesmo popstate, porque a entrada atual deixa de ser a dele.
    const depoisDoMenu = () => {
      window.removeEventListener("popstate", depoisDoMenu);
      empurrar();
    };
    if (window.history.state?.tvChatMenu) {
      window.addEventListener("popstate", depoisDoMenu);
      window.history.back();
    } else {
      empurrar();
    }
    const onPop = () => {
      if (empurrado && !window.history.state?.tvSalaDeitada) setDeitadoDispensado(true);
    };
    window.addEventListener("popstate", onPop);
    return () => {
      ativo = false;
      window.removeEventListener("popstate", depoisDoMenu);
      window.removeEventListener("popstate", onPop);
      // Saiu do modo deitado sem ser pelo voltar (girou o celular, minimizou,
      // fechou a sala): tira a entrada para não deixar entrada órfã.
      if (window.history.state?.tvSalaDeitada) window.history.back();
    };
  }, [deitado]);

  // A presença é contada pelo PresencaTVTracker (montado no TvPlayerProvider),
  // que vale tanto pra sala quanto pro mini player — nada de heartbeat aqui.

  // Uma busca só de GET /api/tv/presenca alimenta o círculo "Sua
  // participação" (linha do próprio jogador = o % que vai ser creditado) e a
  // aba Participantes: a cada 30 s com a aba aberta, 60 s fora dela.
  const [presencaRows, setPresencaRows] = useState<PresencaRow[]>([]);
  const [presencaCarregando, setPresencaCarregando] = useState(true);
  const participantesAberto = tab === "participantes";
  const presencaAtiva = !!myId || participantesAberto;
  useEffect(() => {
    setPresencaRows([]);
    setPresencaCarregando(true);
  }, [programa.id]);
  useEffect(() => {
    if (!presencaAtiva) return;
    let alive = true;
    const load = () => {
      api.listarPresencaTV(programa.id)
        .then((r) => { if (alive) setPresencaRows(r); })
        .catch(() => {})
        .finally(() => { if (alive) setPresencaCarregando(false); });
    };
    load();
    const t = setInterval(load, participantesAberto ? 30_000 : 60_000);
    return () => { alive = false; clearInterval(t); };
  }, [programa.id, presencaAtiva, participantesAberto]);
  const meuPct = useMemo(() => {
    if (!myId || presencaCarregando) return null;
    const minha = presencaRows.find((r) => r.telegram_id === String(myId));
    return minha ? Math.max(0, Math.min(100, Math.round(minha.percentual))) : 0;
  }, [presencaRows, presencaCarregando, myId]);

  const isAdmin = isAdminLogin(login);

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
          {/* O botão de som fica no canto de CIMA: os ~56 px de baixo são a
              barra de controles do próprio player da Kick (com o botão de
              mudo) e nada nosso pode cobrir essa faixa.
              Depois do primeiro toque bem-sucedido nesta sessão, troca o aviso
              grande por um ícone discreto — cada transmissão nova ainda exige
              um toque de verdade (é o navegador quem exige, não dá pra
              pular), mas não precisa mais do aviso chamativo repetido. */}
          <button
            type="button"
            onClick={handleUnmute}
            className={
              unmutedOnce || hasUnmutedThisSession()
                ? "absolute top-2 right-2 z-10 size-10 shrink-0 rounded-full bg-black/60 backdrop-blur text-white flex items-center justify-center shadow-lg active:scale-95 transition"
                : "absolute top-2 right-2 z-10 max-w-[60%] min-w-0 h-10 flex items-center gap-1.5 px-3 rounded-full bg-black/60 backdrop-blur text-white text-xs font-semibold shadow-lg active:scale-95 transition"
            }
            aria-label="Ativar som"
          >
            {unmutedOnce ? (
              <Volume2 className="size-3.5 shrink-0" />
            ) : (
              <>
                <VolumeX className="size-3.5 shrink-0" />
                {!hasUnmutedThisSession() && <span className="truncate">Toque para ativar o som</span>}
              </>
            )}
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

  // Controles por cima do vídeo, só no canto de CIMA (a faixa de baixo é da
  // barra de controles da Kick — ver o botão de som acima).
  const videoTopo = (
    <div className="absolute top-2 left-2 z-10 flex items-center gap-2 min-w-0">
      <button onClick={onBack} className="size-10 shrink-0 rounded-full bg-black/60 backdrop-blur text-white flex items-center justify-center shadow-lg active:scale-95 transition" aria-label="Voltar">
        <ArrowLeft className="size-4 shrink-0" />
      </button>
      <button onClick={onMinimize} className="size-10 shrink-0 rounded-full bg-black/60 backdrop-blur text-white flex items-center justify-center shadow-lg active:scale-95 transition" aria-label="Minimizar (continua tocando)" title="Minimizar — continua tocando">
        <Minimize2 className="size-4 shrink-0" />
      </button>
      {programa.ao_vivo && (
        <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-red-500 text-white text-[10px] font-bold shrink-0">
          <Radio className="size-2.5 shrink-0 animate-pulse" /> LIVE
        </span>
      )}
    </div>
  );

  // Faixa fina logo abaixo do vídeo: título (toque = Sobre), quantos estão
  // assistindo e o círculo da participação.
  const espectadores = programa.ao_vivo && programa.espectadores > 0 ? programa.espectadores : null;
  const faixa = (
    <div className="flex items-center gap-2 px-2 py-1 shrink-0 min-w-0 border-b border-border/60">
      <button
        type="button"
        onClick={() => setTab("sobre")}
        className="flex-1 min-w-0 px-1 py-0.5 text-left rounded-md hover:bg-muted/50 transition"
        title={programa.titulo}
      >
        <span className="block truncate text-sm font-semibold leading-tight">{programa.titulo}</span>
        <span className="flex items-center gap-1 min-w-0 text-[11px] text-muted-foreground leading-tight">
          <Users className="size-3 shrink-0" />
          <span className="truncate">
            {espectadores != null ? `${espectadores.toLocaleString("pt-BR")} assistindo · Sobre` : "Sobre a transmissão"}
          </span>
        </span>
      </button>
      {myId && <ParticipacaoCirculo pct={meuPct} onClick={() => setTab("participantes")} />}
    </div>
  );

  const tabBar = (
    <div
      ref={tabBarScroll.ref}
      className="flex items-center gap-1 px-2 h-9 border-b border-border shrink-0 overflow-x-auto cursor-grab active:cursor-grabbing select-none"
    >
      <StickyScrollArrowLeft show={tabBarScroll.canScrollLeft} onClick={() => tabBarScroll.scrollByAmount(-1)} />
      <StickyScrollArrowRight show={tabBarScroll.canScrollRight} onClick={() => tabBarScroll.scrollByAmount(1)} />
      {/* Na tela larga o chat já fica sempre na coluna da direita, então a
          aba "Chat" sai da fileira: as outras abrem à esquerda. Sem nenhuma
          aberta, a esquerda mostra o "Sobre" (nada de área vazia). */}
      {tabs.filter((t) => !largo || t.id !== "chat").map((t) => {
        const Icon = t.icon;
        const active = tab === t.id || (largo && tab === "chat" && t.id === "sobre");
        return (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`relative shrink-0 h-7 px-2.5 rounded-md text-xs font-semibold flex items-center gap-1.5 transition active:scale-95 ${
              active
                ? "text-primary-foreground shadow-[0_4px_14px_-4px_var(--primary)]"
                : "text-muted-foreground border border-white/10 bg-white/[0.03] backdrop-blur-md hover:bg-white/[0.06]"
            }`}
          >
            {active && <span className="absolute inset-0 rounded-md bg-gradient-to-br from-primary via-primary to-fuchsia-500/80" aria-hidden="true" />}
            <Icon className="relative z-10 size-3.5 shrink-0" /> <span className="relative z-10 whitespace-nowrap">{t.label}</span>
          </button>
        );
      })}
    </div>
  );

  // Conteúdo das abas que não são o chat (no celular em pé substitui o chat;
  // na tela larga aparece à esquerda, com o chat continuando à direita).
  // Na tela larga, sem aba aberta (tab "chat"), mostra o "Sobre".
  const abaEsquerda: WatchTab = tab === "chat" && largo ? "sobre" : tab;
  const painelAba =
    abaEsquerda === "chat" ? null : (
      <div className="flex-1 min-h-0 flex flex-col">
        {abaEsquerda === "redcarpet" && (
          <RedCarpetPanel programa={programa} highlightPostId={highlightPostId} onHighlightConsumed={() => setHighlightPostId(null)} />
        )}
        {abaEsquerda === "participantes" && <ParticipantesPanel rows={presencaRows} loading={presencaCarregando} />}
        {abaEsquerda === "sobre" && <SobrePanel programa={programa} />}
      </div>
    );
  const mostraChat = deitado || largo || tab === "chat";

  // Altura do vídeo no celular em pé: 16:9 da largura + a área do entalhe.
  const alturaVideoMobile = "calc(env(safe-area-inset-top) + 100vw * 9 / 16)";
  const modo = deitado ? "deitado" : largo ? "largo" : "mobile";

  // UMA árvore só para os três modos (só classes/estilos mudam), para o
  // iframe e o chat não serem recriados ao girar o celular.
  //
  // Celular em pé: vídeo e o resto ficam em "position: absolute" (não itens
  // normais de flex) com "top" calculado — de propósito, não é só estética.
  // Como itens comuns de flex, quando o Safari rola pra revelar o campo de
  // digitar acima do teclado, ele rola a COLUNA INTEIRA (arrastando o vídeo
  // pra fora da tela junto). "absolute" tira o vídeo de qualquer fluxo/scroll
  // ancestral — só quem pode rolar é o scroller interno do ChatPanel. E a
  // altura vem de window.visualViewport (área REALMENTE visível, já sem o
  // teclado): ao digitar, encolhe o chat, nunca o vídeo.
  //
  // Tela larga: grade de duas colunas; a parte de baixo vira "display:
  // contents" e os filhos dela entram direto na grade. O vídeo tem altura
  // máxima para a faixa e as abas caberem; o chat ocupa a altura toda da
  // coluna da direita e nunca é empurrado para fora da tela.
  return (
    <div
      className={
        modo === "largo"
          ? "relative h-full min-h-0 overflow-hidden bg-background grid grid-cols-[minmax(0,1fr)_clamp(320px,34%,400px)] grid-rows-[auto_auto_auto_auto_minmax(0,1fr)]"
          : modo === "deitado"
            ? "relative overflow-hidden bg-black flex"
            : "relative overflow-hidden bg-background"
      }
      style={
        modo === "largo"
          ? undefined
          : {
              height: vv ? vv.height : "100%",
              transform: vv?.offsetTop ? `translateY(${vv.offsetTop}px)` : undefined,
              // Celular deitado: controles e coluna do chat fora do entalhe.
              ...(modo === "deitado"
                ? { paddingLeft: "env(safe-area-inset-left)", paddingRight: "env(safe-area-inset-right)" }
                : {}),
            }
      }
    >
      <div
        className={
          modo === "largo"
            ? "col-start-1 row-start-1 w-full bg-black"
            : modo === "deitado"
              ? "relative flex-1 min-w-0 h-full bg-black"
              : "absolute top-0 inset-x-0 z-20 bg-black"
        }
        style={modo === "mobile" ? { paddingTop: "env(safe-area-inset-top)" } : undefined}
      >
        <div
          className={modo === "deitado" ? "relative w-full h-full" : "relative w-full mx-auto"}
          style={
            modo === "deitado"
              ? undefined
              : modo === "largo"
                ? { aspectRatio: "16 / 9", maxHeight: "calc(100dvh - 200px)" }
                : { aspectRatio: "16 / 9" }
          }
        >
          {player}
          {videoTopo}
        </div>
      </div>
      <div
        className={
          modo === "mobile" ? "absolute inset-x-0 bottom-0 flex flex-col" : "contents"
        }
        style={modo === "mobile" ? { top: alturaVideoMobile } : undefined}
      >
        {modo !== "deitado" && <div className={modo === "largo" ? "col-start-1 row-start-2 min-w-0" : "min-w-0"}>{faixa}</div>}
        {modo !== "deitado" && isAdmin && (
          <div className={modo === "largo" ? "col-start-1 row-start-3 min-w-0" : "min-w-0"}>
            <AdminEventoBar programaId={programa.id} />
          </div>
        )}
        {modo !== "deitado" && <div className={modo === "largo" ? "col-start-1 row-start-4 min-w-0" : "min-w-0"}>{tabBar}</div>}
        {modo !== "deitado" && painelAba && (
          <div className={modo === "largo" ? "col-start-1 row-start-5 min-h-0 min-w-0 flex flex-col overflow-hidden" : "flex-1 min-h-0 flex flex-col"}>
            {painelAba}
          </div>
        )}
        {mostraChat && (
          <div
            className={
              modo === "largo"
                ? "col-start-2 row-start-1 row-span-5 min-h-0 min-w-0 flex flex-col border-l border-border bg-card/30"
                : modo === "deitado"
                  ? "dark w-[38%] shrink-0 h-full min-h-0 flex flex-col bg-black/55 text-foreground border-l border-white/10"
                  : "flex-1 min-h-0 flex flex-col"
            }
          >
            <ChatPanel programaId={programa.id} onOpenRedCarpetPost={openRedCarpetPost} />
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- Chat (realtime via Lovable Cloud) ----------
// Linha de mensagem do chat: compacta, com gesto de arrastar (responder) e
// toque longo (menu). Fica compacta para todos; as próprias ganham fundo sutil.
function LinhaMensagem({ id, className, onResponder, onMenu, children }: {
  id: string;
  className?: string;
  onResponder: () => void;
  onMenu: (pos: { x: number; y: number }) => void;
  children: React.ReactNode;
}) {
  const g = useArrastarParaResponder(onResponder, onMenu);
  return (
    <div
      id={id}
      {...g.handlers}
      style={g.style}
      className={`group flex items-start gap-2 rounded-lg px-1.5 py-1 -mx-1 ${className ?? ""}`}
    >
      <div
        className="flex items-start gap-2 flex-1 min-w-0"
        style={{ transform: g.deslocamento ? `translateX(${g.deslocamento}px)` : undefined, transition: g.ativo ? "none" : "transform 150ms ease-out" }}
      >
        {children}
      </div>
    </div>
  );
}

function ChatPanel({ programaId, onOpenRedCarpetPost }: { programaId: string; onOpenRedCarpetPost: (postId: string) => void }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [sending, setSending] = useState(false);
  const [gifPickerOpen, setGifPickerOpen] = useState(false);
  const [gifPickerTab, setGifPickerTab] = useState<"usados" | "recentes">("usados");
  const [gifs, setGifs] = useState<Array<{ id: string; name: string; url: string; isVideo?: boolean; usos?: number }> | null>(null);
  const [uploadingGif, setUploadingGif] = useState(false);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const gifFileRef = useRef<HTMLInputElement>(null);
  // Identidade vem só do login próprio (aba Usuários) — sem Telegram.
  const login = getStoredLogin();
  const displayName = login?.nome || "Anônimo";
  const myId = login?.id;
  const myPhoto = login?.fotoPerfil || "";

  // "Carregar mensagens mais antigas" — explícito (botão), não infinito
  // automático, justamente pra pessoa saber que aquele clique dispara um
  // carregamento. Não sofre o teto MAX_LIVE_MESSAGES (esse só poda o
  // crescimento orgânico do lado ao vivo); aqui é a pessoa pedindo histórico
  // de propósito.
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMoreHistory, setHasMoreHistory] = useState(true);
  // Falha ao buscar as anteriores: o botão do topo vira "Tentar de novo" e o
  // carregamento automático ao rolar para de insistir até a pessoa tocar.
  const [erroAnteriores, setErroAnteriores] = useState(false);
  const OLDER_PAGE_SIZE = 60;
  const justLoadedOlderRef = useRef(false);
  const loadingOlderRef = useRef(false);

  // Rolagem do chat: quem está lendo mensagens antigas não é puxado pro fim.
  // `noFimRef` é medido no onScroll (e de novo logo antes de aplicar uma
  // mensagem nova), SEMPRE antes do DOM crescer. `rolarAoFimRef` é o recado
  // pro efeito de auto-scroll: só rola quando alguém marcou isso.
  const [novas, setNovas] = useState(0);
  const noFimRef = useRef(true);
  const rolarAoFimRef = useRef(false);
  const primeiraCargaRef = useRef(true);
  const messagesRef = useRef<ChatMessage[]>([]);
  messagesRef.current = messages;
  const restaurarAlturaRef = useRef<number | null>(null);
  const listaRef = useRef<HTMLDivElement>(null);
  // Identidade lida via ref no handler realtime (nunca fica velha).
  const idRef = useRef({ myId, displayName });
  idRef.current = { myId, displayName };

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
    primeiraCargaRef.current = true;
    noFimRef.current = true;
    setNovas(0);

    const fetchHistory = async () => {
      const { supabase } = await import("@/integrations/supabase/client");
      // `order(ascending: true).limit(300)` pegava sempre as 300 mensagens
      // MAIS ANTIGAS do programa — depois que um show ao vivo passava desse
      // total, toda mensagem nova sumia de quem recarregava/voltava pro chat
      // (fetchHistory roda de novo a cada visibilitychange). Busca as mais
      // RECENTES (ordem decrescente) e desfaz a ordem só na exibição.
      //
      // Baixado de 300 pra CHAT_HISTORY_LIMIT: em sala cheia com muitos GIFs
      // em vídeo, 300 mensagens montadas de uma vez no DOM (cada GIF-vídeo
      // virando um <video> decodificando) era o principal motivo de celular
      // esquentar/app fechar sozinho — ver bug reportado de "alto fluxo +
      // GIF sobrecarrega". Some isso à janela de vídeos pausados fora de
      // tela (mais abaixo) e ao teto de mensagens vivas (MAX_LIVE_MESSAGES).
      const { data } = await supabase
        .from("tv_chat_messages")
        .select("id,user_name,user_id,user_photo,text,reply_to,created_at")
        .eq("programa_id", programaId)
        .order("created_at", { ascending: false })
        .limit(CHAT_HISTORY_LIMIT);
      if (!alive || !data) return;
      setHasMoreHistory(data.length === CHAT_HISTORY_LIMIT);
      // Carregar a sala sempre leva ao fim; recarga em segundo plano (aba
      // voltou a ficar visível) só rola se a pessoa já estava no fim.
      const elH = scrollerRef.current;
      if (primeiraCargaRef.current || noFimRef.current || (elH && estaNoFim(elH))) {
        rolarAoFimRef.current = true;
        setNovas(0);
      }
      primeiraCargaRef.current = false;
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
            // Decide ANTES de o DOM crescer com a mensagem nova.
            if (!messagesRef.current.some((m) => m.id === r.id)) {
              // Intenção do usuário (ref), não distância ao vivo: mídia que
              // cresce depois de carregar não deve fazer quem acompanha ao
              // vivo parecer "lendo".
              const noFim = noFimRef.current;
              const { myId: mid, displayName: dn } = idRef.current;
              const minha = mid ? r.user_id === mid : r.user_name === dn;
              const d = decidirAoChegar(noFim, minha, 0);
              if (d.rolar) {
                rolarAoFimRef.current = true;
                setNovas(0);
              } else {
                setNovas((n) => decidirAoChegar(false, false, n).novas);
              }
            }
            setMessages((prev) => {
              if (prev.some((m) => m.id === r.id)) return prev;
              const next = [
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
              // Poda só acontece com a pessoa no fim (ver efeito `podar`).
              // Numa transmissão longa e movimentada, essa lista cresceria pra
              // sempre (nunca era podada) — cada mensagem nova virando mais um
              // nó no DOM (e, se for GIF-vídeo, mais um <video> decodificando)
              // até travar o app. Mantém só a janela mais recente.
              return noFimRef.current && next.length > MAX_LIVE_MESSAGES ? next.slice(next.length - MAX_LIVE_MESSAGES) : next;
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

  const loadOlderMessages = async () => {
    if (loadingOlder || loadingOlderRef.current || !hasMoreHistory || messages.length === 0) return;
    loadingOlderRef.current = true;
    setLoadingOlder(true);
    setErroAnteriores(false);
    try {
      const oldestIso = new Date(messages[0].ts).toISOString();
      const { supabase } = await import("@/integrations/supabase/client");
      const { data, error } = await supabase
        .from("tv_chat_messages")
        .select("id,user_name,user_id,user_photo,text,reply_to,created_at")
        .eq("programa_id", programaId)
        .lt("created_at", oldestIso)
        .order("created_at", { ascending: false })
        .limit(OLDER_PAGE_SIZE);
      if (error) throw error;

      const mais = (data || []).map((r: any) => ({
        id: r.id,
        user: r.user_name,
        userId: r.user_id || undefined,
        userPhoto: r.user_photo || undefined,
        text: r.text,
        ts: new Date(r.created_at).getTime(),
        color: colorFor(r.user_name),
        reply_to: r.reply_to || undefined,
      }));
      setHasMoreHistory(mais.length === OLDER_PAGE_SIZE);
      if (mais.length > 0) {
        justLoadedOlderRef.current = true;
        restaurarAlturaRef.current = scrollerRef.current?.scrollHeight ?? null;
        setMessages((prev) => {
          const existentes = new Set(prev.map((m) => m.id));
          return [...mais.reverse().filter((m) => !existentes.has(m.id)), ...prev];
        });
      }
    } catch {
      setErroAnteriores(true);
    } finally {
      loadingOlderRef.current = false;
      setLoadingOlder(false);
    }
  };

  // auto-scroll — pulado quando a mudança em `messages` veio de mensagens
  // antigas (loadOlderMessages cuida da própria posição de scroll, e antigas
  // nunca contam como "novas"). Fora isso, só rola quando quem aplicou a
  // mudança marcou `rolarAoFimRef` (estava no fim, mensagem própria, carga
  // inicial) — quem está lendo mais acima não é puxado.
  useEffect(() => {
    if (justLoadedOlderRef.current) {
      justLoadedOlderRef.current = false;
      return;
    }
    if (!rolarAoFimRef.current) return;
    rolarAoFimRef.current = false;
    const el = scrollerRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
      noFimRef.current = true;
    }
  }, [messages]);

  // Mantém a posição de leitura ao prepender antigas: ajusta no commit
  // (antes da pintura), sem depender de timing de requestAnimationFrame.
  useLayoutEffect(() => {
    const antes = restaurarAlturaRef.current;
    if (antes === null) return;
    restaurarAlturaRef.current = null;
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight - antes;
  }, [messages]);

  // Poda de memória só com a pessoa no fim (nunca tira conteúdo de quem lê).
  // As que saem da memória continuam no servidor: volta a haver "anteriores"
  // (botão do topo / rolar ao topo trazem de volta).
  const podar = () => {
    if (messagesRef.current.length <= MAX_LIVE_MESSAGES) return;
    setHasMoreHistory(true);
    setMessages((prev) => (prev.length > MAX_LIVE_MESSAGES ? prev.slice(prev.length - MAX_LIVE_MESSAGES) : prev));
  };
  useEffect(() => {
    if (noFimRef.current && messages.length > MAX_LIVE_MESSAGES && !loadingOlderRef.current) podar();
  }, [messages]);

  // Mídia (GIF/vídeo) cresce depois de carregar, sem evento de scroll: se a
  // pessoa estava no fim, reancora no fim.
  useEffect(() => {
    const lista = listaRef.current;
    const el = scrollerRef.current;
    if (!lista || !el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (noFimRef.current) el.scrollTop = el.scrollHeight;
    });
    ro.observe(lista);
    return () => ro.disconnect();
  }, []);

  const onScrollChat = () => {
    const el = scrollerRef.current;
    if (!el) return;
    const noFim = estaNoFim(el);
    noFimRef.current = noFim;
    if (noFim) {
      setNovas((n) => (n === 0 ? n : 0));
      if (messagesRef.current.length > MAX_LIVE_MESSAGES && !loadingOlderRef.current) podar();
    }
    if (pertoDoTopo(el.scrollTop) && hasMoreHistory && !loadingOlder && !erroAnteriores) loadOlderMessages();
  };

  const irParaFim = () => {
    const el = scrollerRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    setNovas(0);
  };

  const startReply = (m: ChatMessage) => {
    setReplyTo(m);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  // Menu da mensagem (toque longo / botão direito): Responder e Copiar texto.
  // Entra no histórico: voltar fecha só o menu (regra "voltar = tela anterior").
  const [menuMsg, setMenuMsg] = useState<{ m: ChatMessage; x: number; y: number } | null>(null);
  const abrirMenu = (m: ChatMessage, pos: { x: number; y: number }) => setMenuMsg({ m, ...pos });
  useEffect(() => {
    if (!menuMsg) return;
    window.history.pushState({ tvChatMenu: true }, "");
    const onPop = () => {
      if (!window.history.state?.tvChatMenu) setMenuMsg(null);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [menuMsg]);
  const fecharMenu = () => {
    if (window.history.state?.tvChatMenu) window.history.back();
    else setMenuMsg(null);
  };
  const copiarMensagem = async (m: ChatMessage) => {
    const texto = m.text.startsWith(GIF_PREFIX) || m.text.startsWith(VIDEO_GIF_PREFIX) ? m.text.replace(/^[A-Z_]+::/, "") : m.text;
    try {
      await navigator.clipboard.writeText(texto);
      toast.success("Texto copiado");
    } catch {
      toast.error("Não foi possível copiar");
    }
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
    rolarAoFimRef.current = true; // mensagem própria sempre leva ao fim
    setNovas(0);
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

  const sendGif = async (url: string, isVideo?: boolean, fileId?: string) => {
    setGifPickerOpen(false);
    setSending(true);
    try {
      await sendRaw(`${isVideo ? VIDEO_GIF_PREFIX : GIF_PREFIX}${url}`);
      // Conta uso de verdade (não só quando o seletor é aberto) — base do
      // ranking "Mais usados". Fire-and-forget: nunca atrasa nem bloqueia o
      // envio da mensagem por causa da contagem.
      const id = fileId || url.match(/[?&]id=([\w-]+)/)?.[1];
      if (id) {
        // Atualiza o contador local na hora (otimista) — sem isso, a lista
        // já carregada na memória (gifs !== null evita reconsultar a API
        // toda vez que o seletor reabre) nunca refletia o novo uso, e dois
        // envios seguidos do mesmo GIF não mudavam a ordem em "Mais usados"
        // até a aba ser fechada/reaberta de verdade (confirmado ao vivo).
        setGifs((prev) =>
          prev ? prev.map((g) => (g.id === id ? { ...g, usos: (g.usos || 0) + 1 } : g)) : prev,
        );
        fetch("/api/empire-tv/gifs/usar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileId: id }),
        }).catch(() => {});
      }
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
    <>
      <EnqueteBanner programaId={programaId} />
    {/* Tudo (mensagens + campo de digitar) vive dentro do MESMO container
        rolável. Isso é o que faz o teclado do celular se comportar direito:
        o navegador só consegue rolar internamente pra revelar o campo em
        vez de arrastar a tela inteira (e o vídeo) quando o campo focado
        fica fora de qualquer ancestral rolável. */}
    <div ref={scrollerRef} onScroll={onScrollChat} className="flex-1 overflow-y-auto min-h-0 flex flex-col">
      <div ref={listaRef} className="flex-1 px-3 py-3 space-y-2 text-sm">
        {messages.length === 0 ? (
          <div className="h-full flex items-center justify-center text-muted-foreground text-xs text-center px-6">
            Seja o primeiro a comentar.
          </div>
        ) : (
          <>
            {loadingOlder ? (
              <div className="flex justify-center pb-1 text-[11px] text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" />
              </div>
            ) : hasMoreHistory ? (
              // Além do carregamento automático ao rolar: pra quem prefere
              // tocar, sala com poucas mensagens (sem rolagem) e quando a
              // busca falhou.
              <div className="flex justify-center pb-1 min-w-0">
                <button
                  type="button"
                  onClick={() => loadOlderMessages()}
                  className="min-h-[40px] px-3 max-w-full min-w-0 rounded-full text-[12px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 active:scale-95 transition"
                >
                  <span className="block truncate">
                    {erroAnteriores ? "Tentar de novo" : "↑ Ver mensagens anteriores"}
                  </span>
                </button>
              </div>
            ) : null}
            {messages.map((m) => {
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
            const ehMidia = m.text.startsWith(GIF_PREFIX) || m.text.startsWith(VIDEO_GIF_PREFIX);
            return (
              <LinhaMensagem
                key={m.id}
                id={`tvmsg-${m.id}`}
                className={`${own ? "bg-primary/5" : ""} ${m.pending ? "opacity-50" : ""}`}
                onResponder={() => startReply(m)}
                onMenu={(pos) => abrirMenu(m, pos)}
              >
                <div className="size-6 rounded-full overflow-hidden shrink-0 bg-muted grid place-items-center mt-0.5">
                  {m.userPhoto ? (
                    <SmartImg
                      src={m.userPhoto}
                      alt=""
                      className="w-full h-full object-cover"
                      fallback={<span className={`text-[9px] font-black ${m.color}`}>{m.user.slice(0, 1).toUpperCase()}</span>}
                    />
                  ) : (
                    <span className={`text-[9px] font-black ${m.color}`}>{m.user.slice(0, 1).toUpperCase()}</span>
                  )}
                </div>

                <div className="flex-1 min-w-0 leading-snug break-words">
                  {m.reply_to && (
                    <button
                      type="button"
                      onClick={() => scrollToMsg(m.reply_to!.id)}
                      className="block w-full min-w-0 text-left mb-0.5 pl-2 py-0.5 border-l-2 border-primary/60 text-[11px] rounded-r bg-black/10 hover:bg-black/20 transition-colors truncate"
                    >
                      <span className="font-semibold text-primary/80">{m.reply_to.user}</span>
                      <span className="text-muted-foreground">: {m.reply_to.text.startsWith(GIF_PREFIX) || m.reply_to.text.startsWith(VIDEO_GIF_PREFIX) ? "GIF/figurinha" : m.reply_to.text}</span>
                    </button>
                  )}
                  {ehMidia ? (
                    <>
                      <span className={`block text-[13px] font-bold ${m.color}`}>{m.user}</span>
                      <div className="rounded-2xl overflow-hidden bg-muted/40 min-h-[96px] min-w-[96px] max-w-[180px] mt-0.5">
                        {m.text.startsWith(VIDEO_GIF_PREFIX) ? (
                          <LazyGifVideo src={m.text.slice(VIDEO_GIF_PREFIX.length)} />
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
                    </>
                  ) : (
                    <span className="text-[13px]">
                      <span className={`font-bold ${m.color}`}>{m.user}</span>{" "}
                      <span className="text-foreground">{renderFormattedText(m.text)}</span>
                    </span>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => startReply(m)}
                  className="hidden lg:grid size-6 place-items-center rounded-full opacity-0 group-hover:opacity-100 focus:opacity-100 text-muted-foreground hover:text-primary transition shrink-0"
                  aria-label="Responder"
                >
                  <Reply className="inline size-3.5" />
                </button>
              </LinhaMensagem>
            );
          })}
          </>
        )}
      </div>

      {menuMsg && typeof document !== "undefined" && createPortal(
        <div className="fixed inset-0 z-[200]" onClick={fecharMenu} onContextMenu={(e) => { e.preventDefault(); fecharMenu(); }}>
          <div
            role="menu"
            className="absolute w-44 rounded-xl border border-border bg-popover text-popover-foreground shadow-xl overflow-hidden"
            style={{
              left: Math.max(8, Math.min(menuMsg.x - 88, window.innerWidth - 184)),
              top: Math.max(8, Math.min(menuMsg.y - 8, window.innerHeight - 100)),
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              role="menuitem"
              className="w-full min-w-0 flex items-center gap-2 px-3 py-2.5 text-sm text-left active:bg-muted hover:bg-muted"
              onClick={() => { const m = menuMsg.m; fecharMenu(); startReply(m); }}
            >
              <Reply className="size-4 shrink-0" />
              <span className="truncate">Responder</span>
            </button>
            <button
              type="button"
              role="menuitem"
              className="w-full min-w-0 flex items-center gap-2 px-3 py-2.5 text-sm text-left active:bg-muted hover:bg-muted"
              onClick={() => { const m = menuMsg.m; fecharMenu(); void copiarMensagem(m); }}
            >
              <Copy className="size-4 shrink-0" />
              <span className="truncate">Copiar texto</span>
            </button>
          </div>
        </div>,
        document.body,
      )}

      {/* Grudado no fundo do MESMO scroller das mensagens (não fora dele) —
          é isso que dá ao Safari um ancestral rolável válido pra revelar o
          campo sem precisar deslizar a página/vídeo inteiros. */}
      <div className="sticky bottom-0 bg-background">
      {novas > 0 && (
        <button
          type="button"
          onClick={irParaFim}
          className="absolute bottom-full right-3 mb-2 min-h-[40px] px-3 max-w-[calc(100%-1.5rem)] rounded-full bg-primary text-primary-foreground text-xs font-bold shadow-lg active:scale-95 transition"
        >
          <span className="block truncate">↓ {novas} {novas === 1 ? "nova" : "novas"}</span>
        </button>
      )}
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
          <div className="flex items-center gap-1 px-1 pb-2">
            <button
              type="button"
              onClick={() => setGifPickerTab("usados")}
              className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide transition ${
                gifPickerTab === "usados" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
              }`}
            >
              Mais usados
            </button>
            <button
              type="button"
              onClick={() => setGifPickerTab("recentes")}
              className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide transition ${
                gifPickerTab === "recentes" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
              }`}
            >
              Recentes
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
              // "Mais usados" (padrão) ordena pelo contador real de envios —
              // "Recentes" mantém a ordem natural da API (createdTime desc),
              // garantindo que um upload novo (ainda com 0 usos) sempre
              // apareça pra todo mundo em vez de afundar no fim da lista.
              (gifPickerTab === "usados"
                ? [...gifs].sort((a, b) => (b.usos || 0) - (a.usos || 0))
                : gifs
              ).map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => sendGif(g.url, g.isVideo, g.id)}
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
    </>
  );
}

// Cartão fixo de enquete no topo do Chat — cadastrada à mão na aba ENQUETES
// (planilha "Empire TV Oficial"), sem precisar de deploy pra cada pergunta
// nova. Só aparece quando existe uma enquete ATIVA pra essa sala; unificado
// no Chat (não no Red Carpet) porque o Chat existe em toda sala, não só
// nas de evento.
function EnqueteBanner({ programaId }: { programaId: string }) {
  const login = getStoredLogin();
  const [enquete, setEnquete] = useState<EnquetePayload | null>(null);
  const [enviando, setEnviando] = useState(false);

  const carregar = () => {
    api.buscarEnquete(programaId, login?.id).then(setEnquete);
  };

  useEffect(() => {
    carregar();
    // Reconsulta periodicamente — sem isso, quem já estava com o Chat
    // aberto antes de uma enquete ser cadastrada/ativada na planilha só
    // veria o cartão aparecer se saísse e voltasse pra sala. 20s é rápido o
    // bastante pra parecer "ao vivo" sem pesar na cota de leitura do Sheets
    // (já protegida pelo cache curto de 15s do próprio backend).
    const interval = setInterval(carregar, 20_000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [programaId]);

  const votar = async (nota: number) => {
    if (!enquete || !login?.id || enviando) return;
    setEnviando(true);
    setEnquete((prev) => (prev ? { ...prev, minhaNota: nota } : prev)); // otimista
    try {
      await api.responderEnquete({
        enqueteId: enquete.id,
        programaId,
        tgId: login.id,
        nome: login.nome || "Anônimo",
        nota,
      });
    } finally {
      setEnviando(false);
      carregar(); // busca média/total atualizados
    }
  };

  if (!enquete) return null;

  const notas = Array.from(
    { length: enquete.notaMax - enquete.notaMin + 1 },
    (_, i) => enquete.notaMin + i,
  );

  return (
    <div className="shrink-0 border-b border-border bg-gradient-to-br from-primary/10 via-fuchsia-500/5 to-transparent px-3 py-2.5">
      <div className="flex items-center gap-1.5 mb-1.5">
        <Star className="size-3.5 text-amber-400 fill-amber-400" />
        <span className="text-[10px] font-black uppercase tracking-wide text-muted-foreground">Enquete</span>
      </div>
      <p className="text-xs font-bold mb-2 leading-snug">
        {enquete.pergunta}
        {enquete.alvo && <span className="text-primary"> {enquete.alvo}</span>}
      </p>

      {enquete.minhaNota !== null ? (
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="px-2 py-1 rounded-md bg-primary/15 text-primary font-bold">
            Você votou {enquete.minhaNota}
          </span>
          <span>Voto secreto — obrigado por participar!</span>
        </div>
      ) : (
        <div className="flex items-center gap-1.5 flex-wrap">
          {notas.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => votar(n)}
              disabled={enviando || !login?.id}
              className="size-8 rounded-lg bg-white/5 border border-white/10 hover:bg-primary hover:text-primary-foreground hover:border-primary font-black text-sm transition active:scale-95 disabled:opacity-40"
            >
              {n}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- Red Carpet ----------
function RedCarpetCarousel({ fotos }: { fotos: string[] }) {
  const [idx, setIdx] = useState(0);
  const [expanded, setExpanded] = useState(false);
  if (fotos.length === 0) return null;
  const go = (delta: number) => setIdx((i) => Math.max(0, Math.min(fotos.length - 1, i + delta)));
  return (
    <div className="relative aspect-[4/5] bg-black">
      {/* Foto como background-image (não <img>) — evita o selo nativo
          "Visual Look Up" que o Safari/iOS sobrepõe automaticamente em
          <img> com uma pessoa/objeto reconhecível na cena. */}
      <button
        type="button"
        onClick={() => setExpanded(true)}
        aria-label={`Ver foto do look ${idx + 1} de ${fotos.length} em tela cheia`}
        className="block w-full h-full bg-center bg-cover"
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

      {expanded && (
        <div className="fixed inset-0 z-[60] bg-black/95 flex items-center justify-center" onClick={() => setExpanded(false)}>
          {/* Botão de fechar afastado do topo por env(safe-area-inset-top) —
              mesma correção já aplicada no expandir de capa de álbum
              (Forum.tsx) e na Revista (acervo.tsx): sem isso, colide com o
              notch/status bar e só dá pra sair arrastando pra baixo. */}
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="absolute right-4 z-20 size-9 rounded-full bg-black/60 backdrop-blur grid place-items-center text-white"
            style={{ top: "calc(env(safe-area-inset-top) + 16px)" }}
            aria-label="Fechar"
          >
            <X className="size-5" />
          </button>
          <div
            role="img"
            aria-label={`Foto do look ${idx + 1} de ${fotos.length}`}
            className="w-full h-full bg-center bg-contain bg-no-repeat"
            style={{ backgroundImage: `url(${driveRawImg(fotos[idx])})` }}
            onClick={(e) => e.stopPropagation()}
          />
          {fotos.length > 1 && (
            <>
              {idx > 0 && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); go(-1); }}
                  className="absolute left-3 top-1/2 -translate-y-1/2 size-10 rounded-full bg-black/50 backdrop-blur grid place-items-center text-white"
                  aria-label="Foto anterior"
                >
                  <ChevronLeft className="size-5" />
                </button>
              )}
              {idx < fotos.length - 1 && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); go(1); }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 size-10 rounded-full bg-black/50 backdrop-blur grid place-items-center text-white"
                  aria-label="Próxima foto"
                >
                  <ChevronRight className="size-5" />
                </button>
              )}
              <div className="absolute bottom-6 left-0 right-0 flex justify-center gap-1.5">
                {fotos.map((_, i) => (
                  <span key={i} className={`h-1.5 rounded-full transition-all ${i === idx ? "w-5 bg-white" : "w-1.5 bg-white/40"}`} />
                ))}
              </div>
            </>
          )}
        </div>
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
  const artistasScroll = useDragScroll<HTMLDivElement>();
  const [fotos, setFotos] = useState<string[]>([]);
  const [legenda, setLegenda] = useState("");
  const [uploading, setUploading] = useState(false);
  const [posting, setPosting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  // O carrossel do red carpet exibe as fotos em aspect-[4/5] (retrato),
  // não quadrado — ver RedCarpetCarousel.
  const { cropModal: fotoCropModal, cropImage: cropFoto } = useImageCrop({
    targetW: 960,
    targetH: 1200,
    shape: "square",
    title: "Editar foto",
  });

  const addFotos = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const restantes = Math.max(0, 4 - fotos.length);
    const escolhidas = Array.from(files).slice(0, restantes);
    if (escolhidas.length === 0) return;
    setUploading(true);
    try {
      for (const original of escolhidas) {
        // Recorte restaurado (2026-10-28): a causa real do travamento era a
        // FileList esvaziada antes de ler (ver onChange do input abaixo),
        // não o modal de recorte em si — removê-lo foi só um corte de
        // escopo temporário pra destravar rápido durante o evento ao vivo.
        // Com os arquivos agora chegando aqui de verdade (snapshot já
        // tirado no onChange), cropFoto() volta a funcionar normalmente.
        const cropped = await cropFoto(original);
        if (!cropped) continue; // pulou essa foto
        const file = cropped;
        const formData = new FormData();
        formData.append("file", file);
        formData.append("fileName", file.name);
        formData.append("folderType", "redCarpet");
        // BUG REAL de UI (2026-10-28, reportado como "Red Carpet não
        // funciona"): quando o upload falhava (rede, erro do servidor,
        // arquivo rejeitado), nada acontecia aqui — sem foto adicionada,
        // sem NENHUM aviso. Quem tentava postar via tv a via só o quadrado
        // tracejado vazio de novo, sem pista nenhuma do motivo, e o botão
        // "Publicar" continuava travado (exige fotos.length > 0) sem
        // explicação. Agora todo erro real vira um alert com o motivo.
        let res: Response;
        try {
          res = await fetch("/api/gestao/upload", { method: "POST", body: formData });
        } catch (networkErr) {
          console.error("[RedCarpetComposer] Erro de rede no upload:", networkErr);
          alert("Não deu pra enviar a foto (falha de rede). Tente de novo.");
          continue;
        }
        const data = await res.json().catch(() => null);
        if (res.ok && data?.success && data?.data?.fileUrl) {
          setFotos((prev) => [...prev, data.data.fileUrl as string]);
        } else {
          console.error("[RedCarpetComposer] Upload falhou:", res.status, data);
          alert(data?.error || `Não deu pra enviar a foto (erro ${res.status}). Tente de novo.`);
        }
      }
    } catch (err) {
      console.error("[RedCarpetComposer] Erro no upload:", err);
      alert("Não deu pra enviar a foto. Tente de novo.");
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
            <div
              ref={artistasScroll.ref}
              className="flex gap-2 overflow-x-auto pb-1 cursor-grab active:cursor-grabbing select-none"
            >
              <StickyScrollArrowLeft show={artistasScroll.canScrollLeft} onClick={() => artistasScroll.scrollByAmount(-1)} />
              <StickyScrollArrowRight show={artistasScroll.canScrollRight} onClick={() => artistasScroll.scrollByAmount(1)} />
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
            // BUG REAL (2026-10-28, achado via vídeo de reprodução em iOS E
            // desktop — mesmo comportamento silencioso nos dois): `e.target.
            // files` é uma FileList AO VIVO, presa ao estado interno do
            // próprio <input>. Resetar `e.target.value = ""` ANTES de
            // addFotos() ler esses arquivos limpa essa lista na hora em
            // vários navegadores — o `Array.from(files)` lá dentro já
            // enxergava 0 arquivos, então a função retornava de cara sem
            // fazer nada: sem spinner, sem rede, sem erro, sem foto. Tira um
            // SNAPSHOT de verdade (array) primeiro, só reseta o input
            // depois — agora os arquivos escolhidos sobrevivem ao reset.
            onChange={(e) => {
              const snapshot = e.target.files ? Array.from(e.target.files) : [];
              e.target.value = "";
              if (snapshot.length > 0) {
                const dt = new DataTransfer();
                snapshot.forEach((f) => dt.items.add(f));
                addFotos(dt.files);
              }
            }}
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
      {fotoCropModal}
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
  // Exibição dos artistas copiada direto do Social (ver social.tsx,
  // loadContext): mesma fonte de identidade (useTelegramUser), mesma
  // chamada (api.meusArtistas). O Red Carpet usava getStoredLogin() aqui,
  // uma fonte de id DIFERENTE da que o Social usa — pra um jogador cujo
  // login salvo não bate 1:1 com o id em ARTISTAS, os artistas sumiam só
  // no Red Carpet, mesmo aparecendo certinho no Social. Sem mistério:
  // mesma lógica, mesmo resultado nos dois lugares.
  const { user: tgUser } = useTelegramUser();
  const storiesStripScroll = useDragScroll<HTMLDivElement>();
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
    const tgId = tgUser?.id || "";
    if (tgId) api.meusArtistas(tgId, login?.usuario).then(setMyArtists);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [programa.id, tgUser?.id]);

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
      <div
        ref={storiesStripScroll.ref}
        className="flex gap-3 px-3 py-3 overflow-x-auto cursor-grab active:cursor-grabbing select-none"
      >
        <StickyScrollArrowLeft show={storiesStripScroll.canScrollLeft} onClick={() => storiesStripScroll.scrollByAmount(-1)} />
        <StickyScrollArrowRight show={storiesStripScroll.canScrollRight} onClick={() => storiesStripScroll.scrollByAmount(1)} />
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
type PresencaRow = { telegram_id: string; nome: string; watched_seconds: number; percentual: number };

function ParticipantesPanel({ rows, loading }: { rows: PresencaRow[]; loading: boolean }) {
  const sorted = useMemo(
    () => [...rows].sort((a, b) => b.percentual - a.percentual || b.watched_seconds - a.watched_seconds),
    [rows],
  );

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
              <span className={`min-w-0 font-semibold truncate ${colorFor(p.nome)}`}>{p.nome}</span>
              {/* % do servidor = o que vai ser creditado (0% também); minutos só como informação. */}
              <span className="flex items-baseline gap-1.5 shrink-0 ml-2 tabular-nums">
                <span className="text-[10px] text-muted-foreground/70">{fmtMin(p.watched_seconds)}</span>
                <span className="text-xs font-semibold text-foreground">{`${Math.round(p.percentual)}%`}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Círculo pequeno com a % de participação do próprio jogador; toque abre Participantes. */
function ParticipacaoCirculo({ pct, onClick }: { pct: number | null; onClick: () => void }) {
  const r = 13;
  const c = 2 * Math.PI * r;
  const v = pct ?? 0;
  const cor = v >= 90 ? "text-emerald-400" : v >= 50 ? "text-amber-400" : "text-primary";
  return (
    <button
      type="button"
      onClick={onClick}
      className="relative size-8 min-w-0 shrink-0 px-1 rounded-full hover:bg-muted flex items-center justify-center active:scale-95 transition"
      aria-label={pct == null ? "Sua participação" : `Sua participação: ${v}%`}
      title={pct == null ? "Sua participação" : `Sua participação: ${v}%`}
    >
      <svg viewBox="0 0 32 32" className="absolute inset-0 size-8 -rotate-90 shrink-0" aria-hidden="true">
        <circle cx="16" cy="16" r={r} fill="none" strokeWidth="2.5" className="stroke-muted" />
        <circle
          cx="16"
          cy="16"
          r={r}
          fill="none"
          strokeWidth="2.5"
          strokeLinecap="round"
          stroke="currentColor"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - v / 100)}
          className={`${cor} transition-[stroke-dashoffset] duration-500`}
        />
      </svg>
      <span className="relative truncate text-[9px] font-bold tabular-nums leading-none">
        {pct == null ? "–" : `${v}%`}
      </span>
    </button>
  );
}

/** Faixa só para admin: marca o início e o término reais da transmissão. */
function AdminEventoBar({ programaId }: { programaId: string }) {
  const [enviando, setEnviando] = useState<"inicio" | "fim" | null>(null);
  const [estado, setEstado] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);
  useEffect(() => {
    setEstado(null);
  }, [programaId]);

  const hora = (ts?: number) =>
    ts ? new Date(ts).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "";

  const disparar = async (acao: "inicio" | "fim") => {
    if (enviando) return;
    if (
      acao === "fim" &&
      !window.confirm("Marcar o TÉRMINO do evento agora? A participação de todos será calculada até este momento.")
    ) {
      return;
    }
    setEnviando(acao);
    const r = await api.eventoAdminTV(programaId, acao);
    setEnviando(null);
    if (!r.ok) {
      setEstado({ tipo: "erro", texto: r.erro || "Não foi possível registrar." });
    } else if (acao === "inicio") {
      setEstado({ tipo: "ok", texto: `Início marcado às ${hora(r.inicioTs)}` });
    } else {
      // Crédito sai no próximo cron (até ~15 min) — processamento {0,0} aqui não é falha.
      setEstado({ tipo: "ok", texto: "Encerrado — a participação será creditada em alguns minutos" });
    }
  };

  const btn =
    "min-w-0 shrink-0 h-7 px-2.5 rounded-md text-[11px] font-semibold flex items-center gap-1 border transition active:scale-95 disabled:opacity-50 disabled:pointer-events-none";
  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 px-2 py-1 border-b border-border bg-amber-500/5 shrink-0 min-w-0">
      <span className="flex items-center gap-1 shrink-0 text-[10px] font-bold uppercase tracking-wide text-amber-400">
        <ShieldCheck className="size-3 shrink-0" /> Só admin
      </span>
      <button
        type="button"
        onClick={() => disparar("inicio")}
        disabled={!!enviando}
        className={`${btn} border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10`}
      >
        {enviando === "inicio" ? <Loader2 className="size-3 shrink-0 animate-spin" /> : <Play className="size-3 shrink-0" />}
        <span className="truncate">Início do evento</span>
      </button>
      <button
        type="button"
        onClick={() => disparar("fim")}
        disabled={!!enviando}
        className={`${btn} border-red-500/40 text-red-400 hover:bg-red-500/10`}
      >
        {enviando === "fim" ? <Loader2 className="size-3 shrink-0 animate-spin" /> : <Square className="size-3 shrink-0" />}
        <span className="truncate">Término</span>
      </button>
      {estado && (
        <span
          role="status"
          className={`basis-full min-w-0 text-[10px] leading-tight ${estado.tipo === "erro" ? "text-red-400" : "text-muted-foreground"}`}
        >
          {estado.texto}
        </span>
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

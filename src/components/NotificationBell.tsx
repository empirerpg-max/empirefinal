import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, Bell, BellOff, BellRing, Bug, Heart, Loader2, MessageCircle, Settings, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { useTelegramUser, haptic } from "@/lib/telegram";
import { Switch } from "@/components/ui/switch";
import { nomeDaTela } from "@/lib/uso/nomes";

// "reporte_beta" só chega ao admin: não tem toggle em "O que receber no celular".
type EventoPref = "comentario_forum" | "curtida_social" | "comentario_social";
type Evento = EventoPref | "reporte_beta";

interface NotificacaoItem {
  id: string;
  autorNome: string;
  tipoMedia: string;
  tituloMedia: string;
  topicId: string;
  comentario: string;
  data: string;
  lida: boolean;
  evento?: Evento;
}

type Prefs = Record<EventoPref, boolean>;

const DEFAULT_PREFS: Prefs = {
  curtida_social: true,
  comentario_social: true,
  comentario_forum: true,
};

const PREF_LABELS: { key: EventoPref; titulo: string; descricao: string }[] = [
  {
    key: "curtida_social",
    titulo: "Curtidas nas minhas publicações",
    descricao: "Quando alguém curte um post seu no Empire Social",
  },
  {
    key: "comentario_social",
    titulo: "Comentários nas minhas publicações",
    descricao: "Quando alguém comenta um post seu no Empire Social",
  },
  {
    key: "comentario_forum",
    titulo: "Comentários nos meus lançamentos",
    descricao: "Músicas, álbuns e vídeos dos seus artistas no fórum",
  },
];

const TAB_BY_TIPO: Record<string, string> = {
  musica: "musicas",
  album: "albuns",
  video: "videos",
  "music-video": "videos",
};

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function pushSuportado(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

// iPhone/iPad só recebem push com o app instalado na Tela de Início (iOS 16.4+).
function isIosForaDoApp(): boolean {
  if (typeof window === "undefined") return false;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone =
    window.matchMedia?.("(display-mode: standalone)").matches || (navigator as any).standalone === true;
  return ios && !standalone;
}

async function getPushSubscriptionAtual(): Promise<PushSubscription | null> {
  if (!pushSuportado()) return null;
  try {
    const reg = await navigator.serviceWorker.ready;
    return await reg.pushManager.getSubscription();
  } catch {
    return null;
  }
}

// Sino de notificações — fica fixo ao lado do botão de sincronizar no topo.
// Avisa o jogador quando alguém comenta um lançamento de um artista dele no
// fórum, ou curte/comenta uma publicação dele no Empire Social, com link
// direto pro conteúdo. Sem WebSocket disponível no Worker, faz polling leve
// (60s) enquanto a tela estiver aberta. A engrenagem abre as configurações:
// ativar notificação no celular (Web Push) e escolher quais tipos receber.
export function NotificationBell() {
  const { user: telegramUser } = useTelegramUser();
  const myId = telegramUser?.id ? String(telegramUser.id) : "";
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"lista" | "config">("lista");
  const [items, setItems] = useState<NotificacaoItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);

  // Configurações
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [vapidKey, setVapidKey] = useState("");
  const [pushDisponivel, setPushDisponivel] = useState(false);
  const [inscrito, setInscrito] = useState(false);
  const [permissao, setPermissao] = useState<NotificationPermission | "indisponivel">("default");
  const [carregandoConfig, setCarregandoConfig] = useState(false);
  const [ativando, setAtivando] = useState(false);

  const fetchNotificacoes = async () => {
    if (!myId) return;
    try {
      const res = await fetch(`/api/notificacoes?tgId=${encodeURIComponent(myId)}`);
      const json = await res.json().catch(() => null);
      if (json?.success) {
        setItems(json.data.items || []);
        setUnreadCount(json.data.unreadCount || 0);
      }
    } catch (err) {
      console.error("[NotificationBell] Erro ao buscar notificações:", err);
    }
  };

  const fetchConfig = async () => {
    if (!myId) return;
    setCarregandoConfig(true);
    try {
      setPermissao(pushSuportado() ? Notification.permission : "indisponivel");
      const sub = await getPushSubscriptionAtual();
      const qs = new URLSearchParams({ tgId: myId });
      if (sub) qs.set("endpoint", sub.endpoint);
      const res = await fetch(`/api/notificacoes/preferencias?${qs.toString()}`);
      const json = await res.json().catch(() => null);
      if (json?.success) {
        setPrefs({ ...DEFAULT_PREFS, ...(json.data.prefs || {}) });
        setVapidKey(json.data.vapidPublicKey || "");
        setPushDisponivel(!!json.data.pushDisponivel);
        setInscrito(!!sub && !!json.data.inscrito);
        // Aparelho tem inscrição local mas o servidor não conhece (ex: trocou
        // de conta no mesmo celular) — reenvia pra ficar consistente.
        if (sub && !json.data.inscrito && Notification.permission === "granted" && json.data.pushDisponivel) {
          const ok = await enviarInscricao(sub);
          setInscrito(ok);
        }
      }
    } catch (err) {
      console.error("[NotificationBell] Erro ao carregar configurações:", err);
    } finally {
      setCarregandoConfig(false);
    }
  };

  const enviarInscricao = async (sub: PushSubscription): Promise<boolean> => {
    const res = await fetch("/api/notificacoes/push/inscrever", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tgId: myId, subscription: sub.toJSON() }),
    });
    const json = await res.json().catch(() => null);
    return !!json?.success;
  };

  useEffect(() => {
    if (!myId) return;
    fetchNotificacoes();
    const interval = setInterval(fetchNotificacoes, 60000);
    return () => clearInterval(interval);
  }, [myId]);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const handleToggle = async () => {
    haptic.selection();
    const willOpen = !open;
    setOpen(willOpen);
    if (willOpen) setView("lista");
    if (willOpen && unreadCount > 0 && myId) {
      setLoading(true);
      try {
        await fetch("/api/notificacoes/marcar-lidas", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tgId: myId }),
        });
        setUnreadCount(0);
        setItems((prev) => prev.map((n) => ({ ...n, lida: true })));
      } catch (err) {
        console.error("[NotificationBell] Erro ao marcar como lidas:", err);
      } finally {
        setLoading(false);
      }
    }
  };

  const abrirConfig = () => {
    haptic.selection();
    setView("config");
    fetchConfig();
  };

  const ativarPush = async () => {
    if (!pushSuportado() || !vapidKey) return;
    haptic.selection();
    setAtivando(true);
    try {
      const perm = await Notification.requestPermission();
      setPermissao(perm);
      if (perm !== "granted") {
        toast.error("Permissão negada", {
          description: "Libere as notificações deste site nas configurações do navegador e tente de novo.",
        });
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidKey) as BufferSource,
        });
      }
      const ok = await enviarInscricao(sub);
      setInscrito(ok);
      if (ok) {
        haptic.success();
        toast.success("Notificações ativadas neste aparelho!");
      } else {
        toast.error("Não foi possível ativar agora. Tente de novo em instantes.");
      }
    } catch (err) {
      console.error("[NotificationBell] Erro ao ativar push:", err);
      toast.error("Não foi possível ativar as notificações neste aparelho.");
    } finally {
      setAtivando(false);
    }
  };

  const desativarPush = async () => {
    haptic.selection();
    setAtivando(true);
    try {
      const sub = await getPushSubscriptionAtual();
      if (sub) {
        await fetch("/api/notificacoes/push/desinscrever", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tgId: myId, endpoint: sub.endpoint }),
        }).catch(() => {});
        await sub.unsubscribe().catch(() => {});
      }
      setInscrito(false);
      toast("Notificações desativadas neste aparelho.");
    } finally {
      setAtivando(false);
    }
  };

  const togglePref = async (key: EventoPref, value: boolean) => {
    haptic.selection();
    const anterior = prefs;
    setPrefs({ ...prefs, [key]: value });
    try {
      const res = await fetch("/api/notificacoes/preferencias", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tgId: myId, prefs: { [key]: value } }),
      });
      const json = await res.json().catch(() => null);
      if (!json?.success) throw new Error(json?.error || "falha");
      setPrefs({ ...DEFAULT_PREFS, ...json.data.prefs });
    } catch {
      setPrefs(anterior);
      toast.error("Não foi possível salvar a preferência.");
    }
  };

  if (!myId) return null;

  const renderItem = (n: NotificacaoItem) => {
    const evento = n.evento || "comentario_forum";
    const isSocial = evento === "curtida_social" || evento === "comentario_social";
    const isReporte = evento === "reporte_beta";
    const Icon = evento === "curtida_social" ? Heart : isReporte ? Bug : MessageCircle;
    const conteudo = (
      <div className="flex gap-3">
        <span
          className={`mt-0.5 size-7 shrink-0 grid place-items-center rounded-full ${
            evento === "curtida_social" ? "bg-red-500/15 text-red-400" : "bg-primary/15 text-primary"
          }`}
        >
          <Icon className="size-3.5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs leading-snug break-words">
            <span className="font-bold">{n.autorNome}</span>{" "}
            {evento === "curtida_social" ? (
              "curtiu sua publicação"
            ) : isReporte ? (
              "enviou um reporte do Beta"
            ) : evento === "comentario_social" ? (
              "comentou sua publicação"
            ) : (
              <>
                comentou <span className="font-bold text-primary">{n.tituloMedia}</span>
              </>
            )}
          </p>
          {(isSocial || isReporte) && n.tituloMedia && (
            <p className="text-[11px] text-muted-foreground/80 mt-1 line-clamp-1 break-words italic">
              {isReporte ? nomeDaTela(n.tituloMedia) : n.tituloMedia}
            </p>
          )}
          {n.comentario && (
            <p className="text-[11px] text-muted-foreground mt-1 line-clamp-2 break-words">"{n.comentario}"</p>
          )}
          <p className="text-[10px] text-muted-foreground/70 mt-1">{n.data}</p>
        </div>
      </div>
    );
    const className = `block px-4 py-3 transition-colors hover:bg-white/5 ${!n.lida ? "bg-primary/5" : ""}`;
    const onClick = () => {
      haptic.selection();
      setOpen(false);
    };
    return (
      <li key={n.id}>
        {isReporte ? (
          <Link to="/beta-admin" onClick={onClick} className={className}>
            {conteudo}
          </Link>
        ) : isSocial ? (
          <Link to="/social" search={{ postId: n.topicId }} onClick={onClick} className={className}>
            {conteudo}
          </Link>
        ) : (
          <Link
            to="/empire-play/forum"
            search={{ tab: TAB_BY_TIPO[n.tipoMedia] || "musicas", id: n.topicId }}
            onClick={onClick}
            className={className}
          >
            {conteudo}
          </Link>
        )}
      </li>
    );
  };

  const renderStatusPush = () => {
    if (carregandoConfig) {
      return (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden="true" />
          <span className="truncate">Verificando este aparelho…</span>
        </div>
      );
    }
    if (isIosForaDoApp()) {
      return (
        <p className="text-[11px] text-muted-foreground leading-snug">
          No iPhone/iPad, as notificações só funcionam com o app instalado: toque em{" "}
          <span className="font-bold">Compartilhar</span> → <span className="font-bold">Adicionar à Tela de Início</span>,
          abra o Empire Hub por lá e volte aqui para ativar.
        </p>
      );
    }
    if (!pushSuportado()) {
      return (
        <p className="text-[11px] text-muted-foreground leading-snug">
          Este navegador não suporta notificações no aparelho. Tente pelo Chrome, Edge, Firefox ou Safari atualizado.
        </p>
      );
    }
    if (!pushDisponivel) {
      return (
        <p className="text-[11px] text-muted-foreground leading-snug">
          As notificações no celular ainda estão sendo configuradas. Volte em breve!
        </p>
      );
    }
    if (permissao === "denied") {
      return (
        <p className="text-[11px] text-muted-foreground leading-snug">
          As notificações deste site estão bloqueadas no navegador. Libere nas configurações do site (ícone do cadeado
          ao lado do endereço) e volte aqui.
        </p>
      );
    }
    return inscrito ? (
      <button
        onClick={desativarPush}
        disabled={ativando}
        className="w-full min-w-0 flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl border border-white/10 bg-white/[0.04] text-xs font-bold hover:bg-white/[0.08] active:scale-[0.98] transition-all disabled:opacity-60"
      >
        {ativando ? (
          <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden="true" />
        ) : (
          <BellOff className="size-4 shrink-0" aria-hidden="true" />
        )}
        <span className="truncate">Desativar neste aparelho</span>
      </button>
    ) : (
      <button
        onClick={ativarPush}
        disabled={ativando}
        className="w-full min-w-0 flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-primary text-primary-foreground text-xs font-black hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-60"
      >
        {ativando ? (
          <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden="true" />
        ) : (
          <BellRing className="size-4 shrink-0" aria-hidden="true" />
        )}
        <span className="truncate">Ativar notificações no celular</span>
      </button>
    );
  };

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={handleToggle}
        aria-label={unreadCount > 0 ? `${unreadCount} notificações não lidas` : "Notificações"}
        className="relative size-9 sm:size-11 shrink-0 grid place-items-center rounded-full border border-white/10 bg-white/[0.04] text-foreground active:scale-95 transition-all hover:bg-white/[0.08] hover:border-primary/30"
      >
        <Bell className="size-[18px]" aria-hidden="true" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-black grid place-items-center leading-none border-2 border-background">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          className="fixed left-3 right-3 sm:left-auto sm:right-4 sm:w-[22rem] z-[70] max-h-[70vh] overflow-y-auto rounded-2xl bg-secondary border border-white/10 shadow-2xl animate-in fade-in slide-in-from-top-2 duration-200"
          style={{ top: "calc(4rem + env(safe-area-inset-top) + 0.5rem)" }}
        >
          {view === "lista" ? (
            <>
              <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between gap-2">
                <p className="text-sm font-black truncate min-w-0">Notificações</p>
                <div className="flex items-center gap-2 shrink-0">
                  {loading && <span className="text-[10px] text-muted-foreground">marcando como lidas…</span>}
                  <button
                    onClick={abrirConfig}
                    aria-label="Configurar notificações"
                    className="size-8 shrink-0 grid place-items-center rounded-full hover:bg-white/10 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Settings className="size-4" aria-hidden="true" />
                  </button>
                </div>
              </div>

              {items.length === 0 ? (
                <div className="px-4 py-8 text-center">
                  <MessageCircle className="size-8 mx-auto mb-2 text-muted-foreground/50" aria-hidden="true" />
                  <p className="text-xs text-muted-foreground">
                    Nenhuma notificação ainda. Quando alguém curtir ou comentar algo seu, aparece aqui.
                  </p>
                  <button
                    onClick={abrirConfig}
                    className="mt-3 inline-flex min-w-0 max-w-full items-center gap-1.5 px-3 py-1.5 rounded-full border border-white/10 text-[11px] font-bold hover:bg-white/5 transition-colors"
                  >
                    <Smartphone className="size-3.5 shrink-0" aria-hidden="true" />
                    <span className="truncate">Receber no celular</span>
                  </button>
                </div>
              ) : (
                <ul className="divide-y divide-white/5">{items.map(renderItem)}</ul>
              )}
            </>
          ) : (
            <>
              <div className="px-2 py-2 border-b border-white/10 flex items-center gap-1">
                <button
                  onClick={() => {
                    haptic.selection();
                    setView("lista");
                  }}
                  aria-label="Voltar para notificações"
                  className="size-8 shrink-0 grid place-items-center rounded-full hover:bg-white/10 transition-colors"
                >
                  <ArrowLeft className="size-4" aria-hidden="true" />
                </button>
                <p className="text-sm font-black truncate min-w-0">Configurar notificações</p>
              </div>

              <div className="px-4 py-4 space-y-3 border-b border-white/10">
                <div className="flex items-start gap-3">
                  <span className="size-8 shrink-0 grid place-items-center rounded-full bg-primary/15 text-primary">
                    <Smartphone className="size-4" aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs font-bold">Notificações no celular</p>
                    <p className="text-[11px] text-muted-foreground leading-snug mt-0.5">
                      {inscrito
                        ? "Ativadas neste aparelho. Você recebe avisos mesmo com o app fechado."
                        : "Receba avisos no aparelho mesmo com o app fechado."}
                    </p>
                  </div>
                </div>
                {renderStatusPush()}
              </div>

              <div className="px-4 py-3">
                <p className="text-[10px] font-black uppercase tracking-wider text-muted-foreground mb-1">
                  O que receber no celular
                </p>
                <ul className="divide-y divide-white/5">
                  {PREF_LABELS.map((p) => (
                    <li key={p.key}>
                      <label className="flex items-center gap-3 py-3 cursor-pointer">
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-bold leading-snug">{p.titulo}</p>
                          <p className="text-[11px] text-muted-foreground leading-snug mt-0.5">{p.descricao}</p>
                        </div>
                        <Switch
                          checked={prefs[p.key]}
                          onCheckedChange={(v) => togglePref(p.key, v)}
                          aria-label={p.titulo}
                        />
                      </label>
                    </li>
                  ))}
                </ul>
                <p className="text-[10px] text-muted-foreground/70 leading-snug mt-1">
                  O sininho continua mostrando tudo; essas opções valem para os avisos no aparelho.
                </p>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

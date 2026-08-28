import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Bell, MessageCircle } from "lucide-react";
import { useTelegramUser, haptic } from "@/lib/telegram";

interface NotificacaoItem {
  id: string;
  autorNome: string;
  tipoMedia: string;
  tituloMedia: string;
  topicId: string;
  comentario: string;
  data: string;
  lida: boolean;
}

const TAB_BY_TIPO: Record<string, string> = {
  musica: "musicas",
  album: "albuns",
  video: "videos",
  "music-video": "videos",
};

// Sino de notificações — fica fixo ao lado do botão de sincronizar no topo.
// Avisa o dono de um artista quando alguém comenta um tópico dele (ex:
// "Alan comentou Marilyn Monroe de Rose Thompson"), com link direto pro
// comentário no fórum. Sem WebSocket disponível no Worker, faz polling leve
// (60s) enquanto a tela estiver aberta.
export function NotificationBell() {
  const { user: telegramUser } = useTelegramUser();
  const myId = telegramUser?.id ? String(telegramUser.id) : "";
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificacaoItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);

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

  if (!myId) return null;

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={handleToggle}
        aria-label={unreadCount > 0 ? `${unreadCount} notificações não lidas` : "Notificações"}
        className="relative size-11 shrink-0 grid place-items-center rounded-full border border-white/10 bg-white/[0.04] text-foreground active:scale-95 transition-all hover:bg-white/[0.08] hover:border-primary/30"
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
          <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
            <p className="text-sm font-black">Notificações</p>
            {loading && <span className="text-[10px] text-muted-foreground">marcando como lidas…</span>}
          </div>

          {items.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <MessageCircle className="size-8 mx-auto mb-2 text-muted-foreground/50" aria-hidden="true" />
              <p className="text-xs text-muted-foreground">
                Nenhuma notificação ainda. Quando alguém comentar um tópico seu, aparece aqui.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-white/5">
              {items.map((n) => (
                <li key={n.id}>
                  <Link
                    to="/empire-play/forum"
                    search={{ tab: TAB_BY_TIPO[n.tipoMedia] || "musicas", id: n.topicId }}
                    onClick={() => {
                      haptic.selection();
                      setOpen(false);
                    }}
                    className={`block px-4 py-3 transition-colors hover:bg-white/5 ${
                      !n.lida ? "bg-primary/5" : ""
                    }`}
                  >
                    <p className="text-xs leading-snug break-words">
                      <span className="font-bold">{n.autorNome}</span> comentou{" "}
                      <span className="font-bold text-primary">{n.tituloMedia}</span>
                    </p>
                    {n.comentario && (
                      <p className="text-[11px] text-muted-foreground mt-1 line-clamp-2 break-words">
                        "{n.comentario}"
                      </p>
                    )}
                    <p className="text-[10px] text-muted-foreground/70 mt-1">{n.data}</p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

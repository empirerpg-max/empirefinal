import {
  Outlet,
  Link,
  createRootRouteWithContext,
  HeadContent,
  Scripts,
  useLocation,
  useRouter,
  useRouterState,
} from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Home,
  Crown,
  Library,
  Disc3,
  ListMusic,
  Menu,
  X,
  User,
  Building2,
  ChevronDown,
  TrendingUp,
  Search,
  HelpCircle,
  Share2,
  Tv,
  Send,
  Target,
  PlayCircle,
  Plus,
  LogOut,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Toaster, toast } from "sonner";
import { motion, AnimatePresence } from "motion/react";
import { useTelegramUser, haptic, useTelegramBackButton } from "@/lib/telegram";
import { api, driveImg, type Artist } from "@/lib/api";
import { registerServiceWorker } from "@/lib/pwa";
import { InstallPrompt } from "@/components/InstallPrompt";
import { LoginScreen, getStoredLogin, clearStoredLogin, type LoginResult } from "@/components/LoginScreen";
import { EmpirePlayerProvider, useEmpirePlayer } from "@/components/EmpirePlay/PlayerContext";
import { MusicPlayer } from "@/components/EmpirePlay/MusicPlayer";
import { VideoPlayer } from "@/components/EmpirePlay/VideoPlayer";

function GlobalLinkModal({ onClose }: { onClose: () => void }) {
  const { user } = useTelegramUser();
  const [tab, setTab] = useState<"link" | "create">("link");
  const [available, setAvailable] = useState<Artist[] | null>(null);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [linking, setLinking] = useState(false);

  const [novoNome, setNovoNome] = useState("");
  const [novoFoto, setNovoFoto] = useState("");
  const [novoGravadora, setNovoGravadora] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    api.getArtistasSemId().then(setAvailable);
  }, []);

  const filtered = (available || []).filter((a) => a.nome.toLowerCase().includes(q.toLowerCase()));

  const toggle = (nome: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(nome)) next.delete(nome);
      else next.add(nome);
      return next;
    });
  };

  const handleLinkAll = async () => {
    if (!user || user.id === "guest" || selected.size === 0) return;
    setLinking(true);
    let ok = 0,
      fail = 0;
    for (const nome of selected) {
      try {
        const res = await api.vincularArtista(nome, user.id);
        if (res.ok) ok++;
        else fail++;
      } catch {
        fail++;
      }
    }
    setLinking(false);
    if (ok > 0) {
      toast.success(`${ok} artista${ok > 1 ? "s" : ""} vinculado${ok > 1 ? "s" : ""}!`, {
        description: fail > 0 ? `${fail} falharam.` : "Império expandido.",
      });
      setAvailable((prev) => (prev || []).filter((x) => !selected.has(x.nome)));
      setSelected(new Set());
      onClose();
    } else {
      toast.error("Nenhum vínculo concluído");
    }
  };

  const handleCreate = async () => {
    if (!user || user.id === "guest") {
      toast.error("Conecte seu Telegram primeiro");
      return;
    }
    if (!novoNome.trim() || !novoGravadora.trim()) {
      toast.error("Nome e gravadora são obrigatórios");
      return;
    }
    setCreating(true);
    try {
      const res = await api.criarArtista({
        nome: novoNome.trim(),
        foto: novoFoto.trim(),
        gravadora: novoGravadora.trim(),
        telegram_id: user.id,
      });
      if (res.ok) {
        toast.success("Artista criado!", { description: `${novoNome} entrou no seu plantel.` });
        setNovoNome("");
        setNovoFoto("");
        setNovoGravadora("");
        onClose();
      } else {
        toast.error(res.erro || "Falha ao criar");
      }
    } catch {
      toast.error("Erro na conexão");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
      <motion.div
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        className="w-full max-w-sm bg-card border border-white/10 rounded-[3rem] p-6 shadow-2xl relative max-h-[85vh] flex flex-col"
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 opacity-50 hover:opacity-100 z-10"
        >
          <X className="size-5" />
        </button>

        <h3 className="text-lg font-black tracking-tighter mb-1 text-center">Gerenciar Artistas</h3>
        <p className="text-[10px] text-muted-foreground uppercase font-black tracking-widest text-center mb-4 opacity-60">
          Vincule existentes ou crie um novo
        </p>

        <div className="grid grid-cols-2 gap-2 p-1 bg-white/[0.03] border border-white/5 rounded-2xl mb-4">
          <button
            onClick={() => setTab("link")}
            className={`py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${tab === "link" ? "bg-primary text-primary-foreground shadow-lg" : "text-muted-foreground"}`}
          >
            Vincular
          </button>
          <button
            onClick={() => setTab("create")}
            className={`py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${tab === "create" ? "bg-primary text-primary-foreground shadow-lg" : "text-muted-foreground"}`}
          >
            Criar Novo
          </button>
        </div>

        {tab === "link" ? (
          <>
            <div className="relative mb-3">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Buscar artista..."
                className="w-full h-11 bg-white/5 border border-white/10 rounded-2xl pl-10 pr-4 text-sm font-bold uppercase tracking-tighter outline-none focus:border-primary/40"
              />
            </div>

            <div className="flex-1 overflow-y-auto space-y-2 pr-1 scrollbar-hide py-1 min-h-[200px]">
              {available === null ? (
                <div className="space-y-2">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="h-14 rounded-2xl bg-white/[0.03] animate-pulse" />
                  ))}
                </div>
              ) : filtered.length === 0 ? (
                <div className="text-center py-10 opacity-30">
                  <Library className="size-10 mx-auto mb-2" />
                  <p className="text-[10px] font-black uppercase">Nenhum artista vago</p>
                </div>
              ) : (
                filtered.map((a) => {
                  const isSel = selected.has(a.nome);
                  return (
                    <button
                      key={a.nome}
                      onClick={() => toggle(a.nome)}
                      className={`w-full flex items-center gap-3 p-3 rounded-2xl border transition-all text-left ${isSel ? "bg-primary/15 border-primary/40" : "bg-white/[0.03] border-white/5 hover:bg-white/[0.06]"}`}
                    >
                      <div
                        className={`size-5 rounded-md border-2 flex-shrink-0 grid place-items-center transition-all ${isSel ? "bg-primary border-primary" : "border-white/20"}`}
                      >
                        {isSel && (
                          <span className="text-[10px] font-black text-primary-foreground">✓</span>
                        )}
                      </div>
                      <div className="size-9 rounded-xl bg-primary/10 grid place-items-center font-black text-primary text-xs flex-shrink-0">
                        {a.nome[0]}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-black text-xs truncate uppercase tracking-tight">
                          {a.nome}
                        </p>
                        <p className="text-[10px] text-muted-foreground uppercase font-black opacity-50 truncate">
                          {a.gravadora}
                        </p>
                      </div>
                    </button>
                  );
                })
              )}
            </div>

            <button
              disabled={selected.size === 0 || linking}
              onClick={handleLinkAll}
              className="mt-4 w-full h-14 rounded-[2rem] bg-primary text-primary-foreground font-black uppercase text-[11px] tracking-[0.2em] active:scale-95 transition-all disabled:opacity-30 disabled:cursor-not-allowed shadow-[0_10px_30px_rgba(var(--primary-rgb),0.3)]"
            >
              {linking
                ? "Vinculando..."
                : selected.size === 0
                  ? "Selecione ao menos um"
                  : `Vincular ${selected.size} artista${selected.size > 1 ? "s" : ""}`}
            </button>
          </>
        ) : (
          <div className="flex-1 overflow-y-auto pr-1 space-y-3">
            <div>
              <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-1.5 block">
                Nome do artista *
              </label>
              <input
                value={novoNome}
                onChange={(e) => setNovoNome(e.target.value)}
                placeholder="Ex: Lana Empire"
                className="w-full h-12 bg-white/5 border border-white/10 rounded-2xl px-4 text-sm font-bold outline-none focus:border-primary/40"
              />
            </div>
            <div>
              <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-1.5 block">
                Foto (link Google Drive)
              </label>
              <input
                value={novoFoto}
                onChange={(e) => setNovoFoto(e.target.value)}
                placeholder="https://drive.google.com/file/d/..."
                className="w-full h-12 bg-white/5 border border-white/10 rounded-2xl px-4 text-xs font-bold outline-none focus:border-primary/40"
              />
              <p className="text-[9px] text-muted-foreground/60 mt-1 px-1">
                Cole o link de compartilhamento do Drive. Opcional.
              </p>
            </div>
            <div>
              <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-1.5 block">
                Gravadora *
              </label>
              <input
                value={novoGravadora}
                onChange={(e) => setNovoGravadora(e.target.value)}
                placeholder="Ex: Independent, Empire Records..."
                className="w-full h-12 bg-white/5 border border-white/10 rounded-2xl px-4 text-sm font-bold outline-none focus:border-primary/40"
              />
            </div>
            <button
              disabled={creating || !novoNome.trim() || !novoGravadora.trim()}
              onClick={handleCreate}
              className="mt-2 w-full h-14 rounded-[2rem] bg-primary text-primary-foreground font-black uppercase text-[11px] tracking-[0.2em] active:scale-95 transition-all disabled:opacity-30 shadow-[0_10px_30px_rgba(var(--primary-rgb),0.3)]"
            >
              {creating ? "Criando..." : "Criar Artista"}
            </button>
          </div>
        )}
      </motion.div>
    </div>
  );
}

import appCss from "../styles.css?url";
import logoIcon from "@/assets/logo-icon.png";
import logoFull from "@/assets/logo-full.png";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { name: "theme-color", content: "#000000" },
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      { name: "apple-mobile-web-app-title", content: "Empire" },
      { title: "Empire Hub" },
      {
        name: "description",
        content: "Gerencie seus artistas, suba nos charts e construa um império musical.",
      },
      { name: "author", content: "Empire RPG" },
      { property: "og:title", content: "Empire Hub" },
      {
        property: "og:description",
        content: "Gerencie seus artistas, suba nos charts e construa um império musical.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: "Empire Hub" },
      {
        name: "twitter:description",
        content: "Gerencie seus artistas, suba nos charts e construa um império musical.",
      },
      {
        property: "og:image",
        content:
          "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/130c3ca4-e5a2-42b6-b630-b40d622d345c/id-preview-b6ad8193--6634bb87-7b09-47bf-82c3-5047e8bc7caa.lovable.app-1777495380913.png",
      },
      {
        name: "twitter:image",
        content:
          "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/130c3ca4-e5a2-42b6-b630-b40d622d345c/id-preview-b6ad8193--6634bb87-7b09-47bf-82c3-5047e8bc7caa.lovable.app-1777495380913.png",
      },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "icon", type: "image/png", href: logoIcon },
      { rel: "apple-touch-icon", href: "/icons/apple-touch-icon.png" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=Press+Start+2P&display=swap",
      },
    ],
    scripts: [{ src: "https://telegram.org/js/telegram-web-app.js" }],
  }),
  ssr: false,
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className="dark">
      <head>
        <HeadContent />
        {/* Roda antes do bundle React carregar — pega falhas que deixariam a tela em branco. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function () {
                function report(message, stack) {
                  try {
                    fetch("/api/log-error", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ message: message, stack: stack, path: location.pathname }),
                      keepalive: true,
                    }).catch(function () {});
                  } catch (e) {}
                }
                window.addEventListener("error", function (event) {
                  report(event.message || "Erro desconhecido antes do carregamento", event.error && event.error.stack);
                });
                window.addEventListener("unhandledrejection", function (event) {
                  var reason = event.reason;
                  report(reason && reason.message ? reason.message : String(reason), reason && reason.stack);
                });
              })();
            `,
          }}
        />
      </head>
      <body className="dark bg-background text-foreground">
        {children}
        <Scripts />
      </body>
    </html>
  );
}

// Menu fixo do app — os 9 itens definidos na reorganização: Início,
// Catálogo (ex-Empire Play), Tour, Empire TV, Charts, Ponto, Social, Perfil
// e o botão de Criar (acesso rápido à Gestão de lançamentos).
function BottomNav() {
  const { pathname } = useLocation();
  const perfilFoto = getStoredLogin()?.fotoPerfil || "";
  const items = [
    { to: "/", label: "Início", icon: Home },
    { to: "/empire-play", label: "Catálogo", icon: PlayCircle },
    { to: "/tours", label: "Tour", icon: Building2 },
    { to: "/tv", label: "Empire TV", icon: Tv },
    { to: "/charts", label: "Charts", icon: TrendingUp },
    { to: "/ponto", label: "Ponto", icon: Target },
    { to: "/social", label: "Social", icon: Share2 },
    { to: "/perfil", label: "Perfil", icon: User },
  ];
  return (
    <nav
      className="fixed inset-x-0 z-40 pointer-events-none"
      style={{ bottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
      role="navigation"
      aria-label="Navegação principal"
    >
      <div className="mx-auto w-full max-w-full px-2 pointer-events-auto">
        <div
          className="relative flex items-stretch gap-0.5 rounded-full border border-white/10 bg-white/[0.04] px-1.5 py-1 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.7)] overflow-x-auto scrollbar-hide max-w-full w-fit mx-auto"
          style={{ backdropFilter: "blur(28px) saturate(180%)" }}
        >
          <span className="pointer-events-none absolute inset-0 rounded-full bg-gradient-to-b from-white/[0.06] to-transparent" />
          {items.map((it) => {
            const active = pathname === it.to || (it.to !== "/" && pathname.startsWith(it.to));
            const Icon = it.icon;
            return (
              <Link
                key={it.to}
                to={it.to}
                preload="intent"
                onClick={() => haptic.selection()}
                aria-label={it.label}
                aria-current={active ? "page" : undefined}
                className={`relative flex flex-col items-center justify-center gap-0.5 h-12 w-14 shrink-0 rounded-full transition-all ${
                  active
                    ? "text-primary-foreground bg-primary shadow-[0_8px_24px_-6px_rgba(var(--primary-rgb),0.7)]"
                    : "text-muted-foreground hover:text-foreground hover:bg-white/5"
                }`}
              >
                {it.to === "/perfil" && perfilFoto ? (
                  <img
                    src={driveImg(perfilFoto, 60)}
                    alt=""
                    referrerPolicy="no-referrer"
                    className={`size-[18px] rounded-full object-cover ${active ? "ring-2 ring-primary-foreground/80" : "ring-1 ring-white/20"}`}
                  />
                ) : (
                  <Icon className="size-[18px]" strokeWidth={active ? 2.5 : 2} aria-hidden="true" />
                )}
                <span className="text-[9px] font-bold uppercase tracking-tight leading-none">
                  {it.label}
                </span>
              </Link>
            );
          })}
          <Link
            to="/empire-play/gestao"
            preload="intent"
            onClick={() => haptic.selection()}
            aria-label="Criar"
            className="relative flex flex-col items-center justify-center gap-0.5 h-12 w-14 shrink-0 rounded-full bg-primary/15 text-primary hover:bg-primary/25 transition-all"
          >
            <Plus className="size-[18px]" strokeWidth={2.5} aria-hidden="true" />
            <span className="text-[9px] font-bold uppercase tracking-tight leading-none">Criar</span>
          </Link>
        </div>
      </div>
    </nav>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  return (
    <QueryClientProvider client={queryClient}>
      <AuthGate />
    </QueryClientProvider>
  );
}

// Gate de login pra o app inteiro — o Empire Hub deixou de depender do
// Telegram pra identificar o jogador. Login por usuário/senha (aba
// "Usuários") continua alimentando o mesmo mecanismo de identidade que já
// existia (setUserManually/tg_user_cache), então comentários, Gestão,
// reações etc seguem funcionando sem precisar reescrever cada um deles.
function AuthGate() {
  // Sincroniza o tg_user_cache (mecanismo de identidade usado por Gestão,
  // comentários, reações etc.) já na inicialização, de forma síncrona —
  // ANTES de RootInner montar e seu próprio useTelegramUser() ler o
  // localStorage. Sem isso, um usuário que já estava logado antes
  // (empire_login_user presente, mas tg_user_cache ausente/desatualizado —
  // ex: cache limpo, outra aba, versão antiga do app) nunca tinha o cache
  // recriado a tempo (um useEffect aqui rodaria DEPOIS do efeito interno de
  // RootInner, tarde demais), e o resto do app caía no fallback
  // "guest"/"Artista Independente" mesmo com o login correto.
  const [authUser] = useState<LoginResult | null>(() => {
    const stored = getStoredLogin();
    if (stored) {
      localStorage.setItem(
        "tg_user_cache",
        JSON.stringify({ id: stored.id, name: stored.nome || "Usuário Manual", isTest: true }),
      );
    }
    return stored;
  });
  const [loggedInUser, setLoggedInUser] = useState<LoginResult | null>(authUser);
  const { setUserManually } = useTelegramUser();

  if (!loggedInUser) {
    return (
      <LoginScreen
        onSuccess={(user) => {
          setUserManually(user.id, user.nome);
          setLoggedInUser(user);
        }}
      />
    );
  }

  return (
    <EmpirePlayerProvider>
      <RootInner />
    </EmpirePlayerProvider>
  );
}

// Players montados na raiz do app (fora de qualquer rota-filha) — trocar de
// menu (Início, Catálogo, Charts etc.) nunca desmonta o player, então a
// reprodução de áudio/vídeo continua em qualquer tela, não só dentro do
// Catálogo.
function GlobalPersistentPlayers() {
  const { currentTrack, activePlaylist, currentVideo, closeTrack, closeVideo, setCurrentTrack } =
    useEmpirePlayer();

  return (
    <>
      <MusicPlayer
        currentTrack={currentTrack}
        playlist={activePlaylist}
        onClose={closeTrack}
        onTrackChange={setCurrentTrack}
      />
      <VideoPlayer video={currentVideo} onClose={closeVideo} />
    </>
  );
}

function RootInner() {
  const [isOpen, setIsOpen] = useState(false);
  const [showIdModal, setShowIdModal] = useState(false);
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [manualId, setManualId] = useState("");
  const { user, ready, setUserManually } = useTelegramUser();
  const router = useRouter();
  const { pathname } = useLocation();

  useEffect(() => {
    (window as any).setShowIdModal = setShowIdModal;
    (window as any).setShowLinkModal = setShowLinkModal;
  }, []);

  useEffect(() => {
    registerServiceWorker();
  }, []);

  useEffect(() => {
    const w = window.Telegram?.WebApp;
    if (!w) return;
    const v = (w.version || "0.0").split(".").map(Number);
    if (v[0] * 1000 + (v[1] || 0) < 6001) return;
    try {
      w.setHeaderColor?.("#000000");
      w.setBackgroundColor?.("#000000");
    } catch {}
  }, []);

  const isHome = pathname === "/";
  const handleBack = () => {
    haptic.light();
    router.history.back();
  };
  useTelegramBackButton(!isHome, handleBack);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
    }
  }, [pathname]);

  useEffect(() => {
    setIsOpen(false);
  }, [pathname]);

  const handleManualIdSubmit = () => {
    if (!manualId.trim()) return;
    setUserManually(manualId.trim(), "Magnata");
    setShowIdModal(false);
    haptic.success();
    toast.success("ID Definido", { description: `Conectado como ${manualId}` });
  };

  return (
    <div
      className="min-h-screen flex flex-col bg-background pb-24"
      style={{ paddingTop: "calc(4rem + env(safe-area-inset-top))" }}
    >
      {/* Top Bar */}
      <nav
        className="fixed top-0 inset-x-0 z-[60] flex items-center justify-between px-5 sm:px-6 border-b border-white/[0.06] bg-gradient-to-b from-background/85 via-background/70 to-background/40 pt-[env(safe-area-inset-top)]"
        style={{
          height: "calc(4rem + env(safe-area-inset-top))",
          backdropFilter: "blur(28px) saturate(180%)",
        }}
      >
        <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/15 to-transparent" />
        <span className="pointer-events-none absolute inset-x-0 -bottom-px h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />

        <Link
          to="/"
          className="flex items-center gap-2.5 relative"
          onClick={() => haptic.selection()}
        >
          <div className="relative">
            <img
              src={logoIcon}
              alt="Empire"
              className="size-9 rounded-xl object-contain relative z-10"
            />
            <span className="absolute inset-0 rounded-xl bg-primary/40 blur-lg opacity-60" />
          </div>
          <span className="font-black italic uppercase tracking-tighter text-base leading-none">
            <span className="bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">
              Empire
            </span>
            <span className="text-primary"> Hub</span>
          </span>
        </Link>
        <button
          onClick={() => {
            haptic.light();
            setIsOpen(!isOpen);
          }}
          aria-label={isOpen ? "Fechar menu" : "Abrir menu"}
          aria-expanded={isOpen}
          className="relative size-11 -mr-1 grid place-items-center rounded-full border border-white/10 bg-white/[0.04] text-foreground active:scale-95 transition-all hover:bg-white/[0.08] hover:border-primary/30"
        >
          {isOpen ? <X className="size-5 text-primary" /> : <Menu className="size-5" />}
        </button>
      </nav>

      {/* Hamburger Overlay Menu */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            className="fixed inset-0 z-50 bg-background overflow-y-auto overscroll-contain"
            style={{
              paddingTop: "calc(4rem + env(safe-area-inset-top))",
              paddingBottom: "calc(6rem + env(safe-area-inset-bottom))",
            }}
          >
            <div className="space-y-4 px-4 pt-4">
              <Link
                to="/acesso-rapido"
                onClick={() => setIsOpen(false)}
                className="flex items-center gap-4 p-5 rounded-3xl bg-primary/15 border border-primary/30 text-primary hover:bg-primary/20 transition-all"
              >
                <div className="size-11 rounded-2xl bg-primary text-primary-foreground grid place-items-center">
                  <Send className="size-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-black uppercase tracking-widest text-xs">Acesso Rápido</p>
                  <p className="text-[10px] font-bold uppercase tracking-widest opacity-70">
                    Canais oficiais Telegram
                  </p>
                </div>
              </Link>

              <MenuCategory
                title="Empire Studio"
                icon={Library}
                items={[
                  {
                    to: "/artistas",
                    search: { filter: "all" },
                    label: "Empire Artists",
                    icon: Library,
                  },
                  { to: "/albuns", label: "Discografia", icon: Disc3 },
                  { to: "/empire-play/playlists", label: "Playlists", icon: ListMusic },
                  { to: "/empire-play", label: "Catálogo", icon: PlayCircle },
                ]}
                onClose={() => setIsOpen(false)}
              />

              <div className="pt-8 border-t border-white/5 space-y-3">
                <Link
                  to="/tutorial"
                  onClick={() => setIsOpen(false)}
                  className="flex items-center gap-4 p-4 rounded-3xl bg-white/[0.02] border border-white/5 text-muted-foreground hover:text-foreground transition-all"
                >
                  <HelpCircle className="size-5" />
                  <span className="font-black uppercase tracking-widest text-[10px]">
                    Guia de Sobrevivência
                  </span>
                </Link>
                <button
                  onClick={() => {
                    clearStoredLogin();
                    localStorage.removeItem("tg_user_cache");
                    window.location.reload();
                  }}
                  className="w-full flex items-center gap-4 p-4 rounded-3xl bg-white/[0.02] border border-white/5 text-muted-foreground hover:text-red-400 hover:border-red-500/20 transition-all"
                >
                  <LogOut className="size-5" />
                  <span className="font-black uppercase tracking-widest text-[10px]">Sair</span>
                </button>
                <p className="text-center text-[9px] font-black uppercase tracking-[0.3em] text-muted-foreground/30 pt-4">
                  Empire Hub · v1.0.0
                </p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Modais Globais */}
      <AnimatePresence>
        {showIdModal && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="w-full max-w-sm bg-card border border-white/10 rounded-[3rem] p-8 shadow-2xl relative"
            >
              <button
                onClick={() => setShowIdModal(false)}
                className="absolute top-6 right-6 p-2 rounded-full hover:bg-white/5 transition-colors"
              >
                <X className="size-5 text-muted-foreground" />
              </button>

              <div className="size-16 rounded-3xl bg-primary/10 grid place-items-center mb-6 mx-auto">
                <Crown className="size-8 text-primary" />
              </div>

              <h3 className="text-xl font-black tracking-tighter mb-2 text-center underline decoration-primary decoration-4 underline-offset-4">
                Identidade Imperial
              </h3>
              <p className="text-[11px] text-muted-foreground uppercase font-black tracking-[0.2em] text-center mb-6 px-4 opacity-70">
                Sincronize seu passaporte para acessar seus bens e artistas.
              </p>

              <div className="space-y-4">
                <div className="relative">
                  <input
                    type="text"
                    value={manualId}
                    onChange={(e) => setManualId(e.target.value)}
                    placeholder="DIGITE SEU ID TELEGRAM"
                    className="w-full h-20 bg-white/5 border-2 border-white/10 rounded-3xl px-6 font-black text-center text-xl outline-none focus:border-primary/50 transition-all placeholder:text-white/10"
                  />
                  {!manualId && (
                    <span className="absolute left-1/2 -translate-x-1/2 bottom-3 animate-pulse text-[11px] font-black text-primary uppercase">
                      Obrigatório
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3 pt-2">
                  <button
                    onClick={() => setShowIdModal(false)}
                    className="h-16 rounded-[2rem] bg-white/5 border border-white/10 font-black uppercase text-[10px] tracking-widest active:scale-95 transition-all hover:bg-white/10"
                  >
                    Voltar
                  </button>
                  <button
                    onClick={handleManualIdSubmit}
                    className="h-16 rounded-[2rem] bg-primary text-primary-foreground font-black uppercase text-[10px] tracking-[0.2em] active:scale-95 transition-all shadow-[0_10px_30px_rgba(var(--primary-rgb),0.3)] shadow-primary/20"
                  >
                    Conectar
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}

        {showLinkModal && <GlobalLinkModal onClose={() => setShowLinkModal(false)} />}
      </AnimatePresence>

      <RouteTransitionOverlay />
      <Outlet />

      <GlobalPersistentPlayers />
      <BottomNav />
      <InstallPrompt />
      <Toaster position="top-center" richColors closeButton offset={80} />
    </div>
  );
}

function RouteTransitionOverlay() {
  const isLoading = useRouterState({ select: (s) => s.isLoading });
  return (
    <AnimatePresence>
      {isLoading && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-[100] grid place-items-center bg-background/85 backdrop-blur-sm pointer-events-none"
        >
          <motion.img
            src={logoIcon}
            alt=""
            className="size-20 object-contain drop-shadow-[0_0_30px_rgba(var(--primary-rgb),0.5)]"
            animate={{ scale: [1, 1.08, 1], opacity: [0.8, 1, 0.8] }}
            transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function MenuCategory({ title, icon: Icon, items, onClose }: any) {
  // Começa fechado para não sobrecarregar a tela em mobile
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="space-y-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-4 rounded-3xl bg-white/[0.02] border border-white/5 text-left group active:scale-[0.98] transition-all"
      >
        <div className="flex items-center gap-3">
          <div className="size-8 rounded-xl bg-primary/10 text-primary grid place-items-center">
            <Icon className="size-4" />
          </div>
          <span className="font-black uppercase tracking-widest text-xs group-hover:text-primary transition-colors">
            {title}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold text-muted-foreground/40 uppercase tracking-widest">
            {items.length} itens
          </span>
          <ChevronDown
            className={`size-4 text-muted-foreground transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
          />
        </div>
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div className="grid grid-cols-2 gap-2 px-1 pb-1">
              {items.map((it: any, i: number) => (
                <Link
                  key={i}
                  to={it.to}
                  search={it.search}
                  onClick={() => {
                    haptic.selection();
                    onClose();
                  }}
                  className="flex flex-col items-center justify-center gap-2 p-5 rounded-[2rem] bg-card border border-white/5 hover:border-primary/20 active:scale-95 transition-all text-center group min-h-[90px]"
                >
                  <div className="size-11 rounded-2xl bg-white/5 text-muted-foreground group-hover:bg-primary group-hover:text-primary-foreground transition-all grid place-items-center">
                    <it.icon className="size-5" />
                  </div>
                  <span className="font-black uppercase tracking-widest text-[10px] text-muted-foreground/60 group-hover:text-foreground leading-tight">
                    {it.label}
                  </span>
                </Link>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

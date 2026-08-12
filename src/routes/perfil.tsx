import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  User,
  LogOut,
  ChevronRight,
  Library,
  Crown,
  Pencil,
  X,
  Check,
  ImageIcon,
  Loader2,
  Heart,
  ListMusic,
} from "lucide-react";
import { useTelegramUser, haptic } from "@/lib/telegram";
import {
  api,
  driveImg,
  driveRawImg,
  fmtEC,
  type Artist,
  type NivelJogador,
  type PlaylistPayload,
  type PlaylistTrack,
} from "@/lib/api";
import { getStoredLogin, setStoredLogin, clearStoredLogin } from "@/components/LoginScreen";
import { BUILD_ID } from "@/lib/pwa";
import { toast } from "sonner";

export const Route = createFileRoute("/perfil")({
  component: Perfil,
});

type LoadState<T> = { status: "loading" } | { status: "error" } | { status: "ok"; data: T };

function Perfil() {
  const { user } = useTelegramUser();
  const [login, setLogin] = useState(getStoredLogin());
  const [myArtists, setMyArtists] = useState<LoadState<Artist[]>>({ status: "loading" });
  const [isEditing, setIsEditing] = useState(false);
  const [editNome, setEditNome] = useState("");
  const [editFoto, setEditFoto] = useState("");
  const [uploadingFoto, setUploadingFoto] = useState(false);
  const [savingPerfil, setSavingPerfil] = useState(false);
  const [libTab, setLibTab] = useState<"salvos" | "playlists">("salvos");
  const [salvos, setSalvos] = useState<LoadState<PlaylistTrack[]>>({ status: "loading" });
  const [minhasPlaylists, setMinhasPlaylists] = useState<LoadState<PlaylistPayload[]>>({ status: "loading" });
  const [nivel, setNivel] = useState<NivelJogador | null>(null);

  const tgId = (typeof window !== "undefined" ? localStorage.getItem("empire_tg_id") : null) || user?.id || "";

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

  useEffect(() => {
    if (!login?.usuario && !tgId) return;
    api.meuNivel({ telegramId: tgId || undefined, usuario: login?.usuario }).then(setNivel);
  }, [tgId, login?.usuario]);

  useEffect(() => {
    if (!tgId) return;
    api
      .listarSalvos(tgId)
      .then((d) => setSalvos({ status: "ok", data: d }))
      .catch(() => setSalvos({ status: "error" }));
    api
      .listarPlaylists()
      .then((all) =>
        setMinhasPlaylists({ status: "ok", data: all.filter((p) => String(p.telegram_id) === String(tgId)) }),
      )
      .catch(() => setMinhasPlaylists({ status: "error" }));
  }, [tgId]);

  const openLinkModal = () => {
    haptic.light();
    (window as any).setShowLinkModal?.(true);
  };

  const startEditing = () => {
    haptic.light();
    setEditNome(login?.nome || "");
    setEditFoto(login?.fotoPerfil || "");
    setIsEditing(true);
  };

  const handleUploadFoto = async (file: File) => {
    setUploadingFoto(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("fileName", file.name);
      formData.append("folderType", "playerAvatars");
      const res = await fetch("/api/gestao/upload", { method: "POST", body: formData });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.success && data?.data?.fileUrl) {
        setEditFoto(data.data.fileUrl);
      } else {
        toast.error("Não foi possível enviar a foto.");
      }
    } catch {
      toast.error("Não foi possível enviar a foto.");
    } finally {
      setUploadingFoto(false);
    }
  };

  const handleSavePerfil = async () => {
    if (!login?.usuario || savingPerfil) return;
    setSavingPerfil(true);
    try {
      const res = await fetch("/api/auth/perfil", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ usuario: login.usuario, nome: editNome, fotoPerfil: editFoto }),
      });
      const json = await res.json().catch(() => null);
      if (res.ok && json?.success && json.data) {
        setStoredLogin(json.data);
        setLogin(json.data);
        setIsEditing(false);
        haptic.success();
        toast.success("Perfil atualizado.");
      } else {
        toast.error(json?.error || "Não foi possível salvar o perfil.");
      }
    } catch {
      toast.error("Erro de conexão ao salvar o perfil.");
    } finally {
      setSavingPerfil(false);
    }
  };

  return (
    <div className="pb-24 px-4 pt-6 max-w-md mx-auto min-h-screen">
      <header className="flex flex-col items-center text-center mb-8">
        {isEditing ? (
          <>
            <div className="relative mb-4">
              <div className="size-24 rounded-full bg-primary/20 border-2 border-primary/30 grid place-items-center overflow-hidden">
                {editFoto ? (
                  <img
                    src={driveImg(editFoto, 200)}
                    className="size-24 rounded-full object-cover"
                    alt=""
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <User className="size-10 text-primary" />
                )}
              </div>
              <label className="absolute -bottom-1 -right-1 size-9 rounded-full bg-primary text-primary-foreground grid place-items-center border-2 border-background cursor-pointer active:scale-90 transition-transform">
                {uploadingFoto ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <ImageIcon className="size-4" />
                )}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  disabled={uploadingFoto}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleUploadFoto(file);
                  }}
                />
              </label>
            </div>
            <input
              type="text"
              value={editNome}
              onChange={(e) => setEditNome(e.target.value)}
              placeholder="Seu nome"
              className="w-full max-w-[16rem] px-4 py-2.5 bg-white/5 border border-white/10 rounded-2xl text-sm text-center font-black uppercase outline-none focus:border-primary/50 transition"
            />
            <p className="text-[10px] text-muted-foreground/70 mb-3 max-w-[16rem]">
              Esse é também o usuário usado pra entrar no app — mudar aqui muda seu login.
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setIsEditing(false)}
                className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-white/5 border border-white/10 text-xs font-black uppercase tracking-wider"
              >
                <X className="size-3.5" /> Cancelar
              </button>
              <button
                onClick={handleSavePerfil}
                disabled={savingPerfil || !editNome.trim()}
                className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-primary text-primary-foreground text-xs font-black uppercase tracking-wider disabled:opacity-50"
              >
                {savingPerfil ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                Salvar
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="size-24 rounded-full bg-primary/20 border-2 border-primary/30 grid place-items-center overflow-hidden mb-4">
              {login?.fotoPerfil || user?.photo_url ? (
                <img
                  src={driveImg(login?.fotoPerfil || user?.photo_url || "", 200)}
                  className="size-24 rounded-full object-cover"
                  alt={login?.nome || user?.name || "Foto do jogador"}
                  referrerPolicy="no-referrer"
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

            {nivel?.nivelAtual && (
              <div className="mt-4 w-full max-w-xs flex items-center gap-3 bg-white/5 border border-white/10 rounded-2xl p-3">
                {nivel.nivelAtual.badge ? (
                  <img
                    src={driveRawImg(nivel.nivelAtual.badge)}
                    alt={nivel.nivelAtual.nome}
                    referrerPolicy="no-referrer"
                    className="size-14 object-contain flex-shrink-0"
                  />
                ) : (
                  <Crown className="size-8 text-primary flex-shrink-0" />
                )}
                <div className="flex-1 min-w-0 text-left">
                  <p className="text-[10px] font-bold uppercase text-muted-foreground tracking-wider truncate">
                    Nível {nivel.nivelAtual.nivel} · {nivel.nivelAtual.fase}
                  </p>
                  <p className="text-sm font-black uppercase truncate">{nivel.nivelAtual.nome}</p>
                  <div className="mt-1.5 h-1.5 rounded-full bg-white/10 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-primary transition-all"
                      style={{ width: `${Math.round(nivel.progresso * 100)}%` }}
                    />
                  </div>
                  <p className="mt-1 text-[10px] font-medium text-muted-foreground">
                    {nivel.proximoNivel
                      ? `${nivel.prestigioAtual} / ${nivel.proximoNivel.prestigio} prestígio pro próximo nível`
                      : `${nivel.prestigioAtual} prestígio · nível máximo`}
                  </p>
                </div>
              </div>
            )}

            {login?.usuario && (
              <button
                onClick={startEditing}
                className="mt-3 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-[11px] font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground transition"
              >
                <Pencil className="size-3" /> Editar Perfil
              </button>
            )}
          </>
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
                    referrerPolicy="no-referrer"
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

      <section className="mb-8">
        <div className="grid grid-cols-2 gap-2 p-1 bg-white/5 border border-white/10 rounded-2xl mb-3">
          <button
            onClick={() => {
              haptic.selection();
              setLibTab("salvos");
            }}
            className={`py-2 rounded-xl text-[11px] font-black uppercase tracking-widest inline-flex items-center justify-center gap-1.5 transition-all ${libTab === "salvos" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
          >
            <Heart className="size-3.5" /> Salvos
          </button>
          <button
            onClick={() => {
              haptic.selection();
              setLibTab("playlists");
            }}
            className={`py-2 rounded-xl text-[11px] font-black uppercase tracking-widest inline-flex items-center justify-center gap-1.5 transition-all ${libTab === "playlists" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
          >
            <ListMusic className="size-3.5" /> Minhas Playlists
          </button>
        </div>

        {libTab === "salvos" ? (
          salvos.status === "loading" ? (
            <div className="space-y-2">
              {[1, 2].map((i) => (
                <div key={i} className="h-14 rounded-2xl bg-white/5 animate-pulse" />
              ))}
            </div>
          ) : salvos.status === "ok" && salvos.data.length > 0 ? (
            <div className="space-y-2">
              {salvos.data.map((t, i) => (
                <div
                  key={`${t.drive_url}-${i}`}
                  className="flex items-center gap-3 p-2.5 rounded-2xl bg-white/5 border border-white/10"
                >
                  <div className="size-11 rounded-xl bg-secondary overflow-hidden flex-shrink-0 border border-white/10 grid place-items-center">
                    {t.capa_url ? (
                      <img
                        src={driveImg(t.capa_url, 100)}
                        className="w-full h-full object-cover"
                        alt=""
                        loading="lazy"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <Heart className="size-4 text-muted-foreground" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold truncate">{t.titulo}</p>
                    <p className="text-[11px] text-muted-foreground truncate">{t.artistas}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="w-full p-6 rounded-2xl bg-card/50 border-2 border-dashed border-primary/20 flex flex-col items-center text-center">
              <Heart className="size-8 text-primary mb-2" />
              <p className="text-sm font-black uppercase">Nenhuma faixa salva ainda</p>
              <p className="text-[11px] text-muted-foreground mt-1">
                Toque no ⋮ de uma faixa e escolha "Salvar em Suas Curtidas".
              </p>
            </div>
          )
        ) : minhasPlaylists.status === "loading" ? (
          <div className="space-y-2">
            {[1, 2].map((i) => (
              <div key={i} className="h-14 rounded-2xl bg-white/5 animate-pulse" />
            ))}
          </div>
        ) : minhasPlaylists.status === "ok" && minhasPlaylists.data.length > 0 ? (
          <div className="space-y-2">
            {minhasPlaylists.data.map((p) => (
              <Link
                key={p.id}
                to="/empire-play/playlists/$id"
                params={{ id: p.id! }}
                onClick={() => haptic.selection()}
                className="flex items-center gap-3 p-2.5 rounded-2xl bg-white/5 border border-white/10 hover:bg-white/[0.08] transition-all"
              >
                <div className="size-11 rounded-xl bg-secondary overflow-hidden flex-shrink-0 border border-white/10 grid place-items-center">
                  {p.capa_url ? (
                    <img
                      src={driveImg(p.capa_url, 100)}
                      className="w-full h-full object-cover"
                      alt=""
                      loading="lazy"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <ListMusic className="size-4 text-muted-foreground" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold truncate">{p.titulo}</p>
                  <p className="text-[11px] text-muted-foreground truncate">{p.tracks?.length || 0} faixas</p>
                </div>
                <ChevronRight className="size-4 text-muted-foreground" />
              </Link>
            ))}
          </div>
        ) : (
          <Link
            to="/empire-play/playlists/nova"
            onClick={() => haptic.selection()}
            className="w-full p-6 rounded-2xl bg-card/50 border-2 border-dashed border-primary/20 flex flex-col items-center text-center hover:bg-primary/5 transition-all"
          >
            <ListMusic className="size-8 text-primary mb-2" />
            <p className="text-sm font-black uppercase">Crie sua primeira playlist</p>
          </Link>
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

      <p className="mt-6 text-center text-[10px] font-mono text-muted-foreground/40">
        build {BUILD_ID}
      </p>
    </div>
  );
}

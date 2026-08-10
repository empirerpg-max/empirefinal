import { useEffect, useState } from "react";
import { User, ShieldCheck, Music2, RefreshCw, Sparkles } from "lucide-react";
import { useTelegramUser, haptic } from "@/lib/telegram";

export interface EmpireUserProfile {
  telegram_id: string;
  name: string;
  username?: string;
  photo_url?: string;
  artistas?: Array<{ nome: string; foto?: string; gravadora?: string }>;
  total_artistas?: number;
  status?: string;
}

export function EmpirePlayHeader() {
  const { user, ready } = useTelegramUser();
  const [profile, setProfile] = useState<EmpireUserProfile | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchProfile = async () => {
    if (!user || user.id === "guest") return;
    setLoading(true);
    try {
      const res = await fetch(`/api/user/me?telegram_id=${user.id}`, {
        headers: {
          "x-telegram-id": user.id,
        },
      });
      if (res.ok) {
        const json = await res.json();
        if (json.success && json.data) {
          setProfile(json.data);
        }
      }
    } catch (err) {
      console.warn("[EmpirePlayHeader] Erro ao buscar perfil em /api/user/me:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (ready && user) {
      fetchProfile();
    }
  }, [ready, user]);

  const telegramSdkUser =
    typeof window !== "undefined" ? window.Telegram?.WebApp?.initDataUnsafe?.user : undefined;

  const displayName = profile?.name || telegramSdkUser?.first_name || user?.name || "Empire Player";

  const displayUsername = profile?.username || telegramSdkUser?.username || user?.username || "";

  const displayPhoto = profile?.photo_url || user?.photo_url || "";

  return (
    <header className="relative w-full overflow-hidden rounded-3xl bg-gradient-to-r from-neutral-900 via-black to-neutral-900 border border-white/10 p-5 shadow-2xl mb-6">
      {/* Glow e Gradiente de Fundo */}
      <div className="pointer-events-none absolute -top-12 -right-12 size-40 bg-emerald-500/20 rounded-full blur-3xl" />
      <div className="pointer-events-none absolute -bottom-12 -left-12 size-40 bg-red-500/20 rounded-full blur-3xl" />

      <div className="relative flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        {/* Identificação do Jogador */}
        <div className="flex items-center gap-4 min-w-0">
          <div className="relative flex-shrink-0">
            <div className="size-16 rounded-2xl bg-gradient-to-br from-emerald-500 to-red-600 p-0.5 shadow-xl">
              <div className="size-full rounded-[14px] bg-neutral-950 overflow-hidden flex items-center justify-center">
                {displayPhoto ? (
                  <img src={displayPhoto} alt={displayName} className="size-full object-cover" />
                ) : (
                  <User className="size-8 text-neutral-400" />
                )}
              </div>
            </div>
            <span
              className="absolute -bottom-1 -right-1 size-5 rounded-full bg-emerald-500 border-2 border-black grid place-items-center"
              title="Autenticado"
            >
              <ShieldCheck className="size-3 text-black font-bold" />
            </span>
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-[10px] font-black uppercase tracking-wider flex items-center gap-1">
                <Sparkles className="size-3" />
                Catálogo
              </span>
              {telegramSdkUser?.id && (
                <span className="text-[10px] font-mono text-neutral-400">
                  ID: {telegramSdkUser.id}
                </span>
              )}
            </div>

            <h1 className="text-xl font-black tracking-tight text-white truncate mt-1">
              {displayName}
            </h1>

            {displayUsername && (
              <p className="text-xs font-medium text-neutral-400 truncate">@{displayUsername}</p>
            )}
          </div>
        </div>

        {/* Status / Ações */}
        <div className="flex items-center gap-3 w-full sm:w-auto justify-between sm:justify-end border-t sm:border-t-0 border-white/5 pt-3 sm:pt-0">
          {profile?.artistas && profile.artistas.length > 0 && (
            <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-2xl px-3 py-2">
              <Music2 className="size-4 text-emerald-400" />
              <div className="text-left">
                <p className="text-[9px] font-bold uppercase text-neutral-400 tracking-wider">
                  Plantel
                </p>
                <p className="text-xs font-black text-white leading-none">
                  {profile.artistas.length} {profile.artistas.length === 1 ? "Artista" : "Artistas"}
                </p>
              </div>
            </div>
          )}

          <button
            onClick={() => {
              haptic.light();
              fetchProfile();
            }}
            disabled={loading}
            title="Atualizar Perfil"
            className="size-11 rounded-2xl bg-white/5 border border-white/10 grid place-items-center active:scale-95 hover:bg-white/10 transition-all text-neutral-300 hover:text-white"
          >
            <RefreshCw className={`size-4 ${loading ? "animate-spin text-emerald-400" : ""}`} />
          </button>
        </div>
      </div>
    </header>
  );
}

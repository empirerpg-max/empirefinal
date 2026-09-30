import { useEffect, useState } from "react";
import { Radio, Trash2, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { haptic } from "@/lib/telegram";
import { toast } from "sonner";

const PLATAFORMA_LABEL: Record<string, string> = {
  SPOTIFY: "Spotify",
  "APPLE MUSIC": "Apple Music",
  YOUTUBE: "YouTube",
};

function formatDataExpira(iso: string): string {
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return "";
  return data.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

// Spotlight Banner comprado no Market — mostra aqui em Gestão (pra
// qualquer jogador dono de artista, não só admin) pra conferir status e
// excluir se algo foi comprado errado/precisa trocar antes dos 4 dias
// acabarem.
export function MeusSpotlightBanners({ telegramId }: { telegramId: string }) {
  const [banners, setBanners] = useState<
    { id: string; artista: string; titulo: string; plataforma: string; imagemUrl: string; dataExpira: string; ativo: boolean }[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [excluindoId, setExcluindoId] = useState<string | null>(null);

  const carregar = () => {
    if (!telegramId) return;
    setLoading(true);
    api
      .listarMeusBanners(telegramId)
      .then((data) => setBanners(data.filter((b) => b.ativo)))
      .finally(() => setLoading(false));
  };

  useEffect(carregar, [telegramId]);

  const excluir = async (bannerId: string) => {
    haptic.light();
    setExcluindoId(bannerId);
    try {
      const res = await api.deletarBanner({ telegramId, bannerId });
      if (res.success) {
        haptic.success();
        toast.success("Banner removido.");
        setBanners((prev) => prev.filter((b) => b.id !== bannerId));
      } else {
        toast.error(res.error || "Não foi possível remover.");
      }
    } catch {
      toast.error("Erro de conexão.");
    } finally {
      setExcluindoId(null);
    }
  };

  if (loading || banners.length === 0) return null;

  return (
    <div className="space-y-2.5">
      <p className="text-[10px] font-black uppercase tracking-widest text-neutral-400 flex items-center gap-1.5 px-1">
        <Radio className="size-3.5 text-amber-400" /> Meus Spotlight Banners
      </p>
      {banners.map((b) => (
        <div
          key={b.id}
          className="flex items-center gap-3 p-3 rounded-2xl bg-neutral-900 border border-white/10"
        >
          <img src={b.imagemUrl} alt="" className="size-12 rounded-xl object-cover shrink-0 bg-white/5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-white truncate">{b.titulo}</p>
            <p className="text-[11px] text-neutral-500">
              {b.artista} · {PLATAFORMA_LABEL[b.plataforma] || b.plataforma} · até {formatDataExpira(b.dataExpira)}
            </p>
          </div>
          <button
            onClick={() => excluir(b.id)}
            disabled={excluindoId === b.id}
            className="size-8 rounded-full bg-red-500/10 border border-red-500/20 text-red-400 grid place-items-center shrink-0 disabled:opacity-50"
          >
            {excluindoId === b.id ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
          </button>
        </div>
      ))}
    </div>
  );
}

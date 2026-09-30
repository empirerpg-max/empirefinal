import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { api } from "@/lib/api";
import { useTelegramUser } from "@/lib/telegram";

interface Banner {
  id: string;
  artista: string;
  titulo: string;
  imagemUrl: string;
  topicoId: string;
  tab: string;
}

const ROTATE_MS = 3000;
const TAB_WIDTH = 14;
const TAB_GAP = 5;

// Item "Spotlight" do Market: banner rotativo comprado por artista (1
// ativo por vez), aparece aqui na home por 4 dias. O ativo fica em
// destaque; os demais compradores ficam em "pastinhas" empilhadas na
// direita, na ordem de compra — quando o ativo troca, a próxima entra.
export function SpotlightBannerCarousel() {
  const { user } = useTelegramUser();
  const navigate = useNavigate();
  const [banners, setBanners] = useState<Banner[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    api.listarBannersAtivos().then(setBanners);
  }, []);

  useEffect(() => {
    if (banners.length < 2) return;
    const timer = setInterval(() => {
      setActiveIndex((i) => (i + 1) % banners.length);
    }, ROTATE_MS);
    return () => clearInterval(timer);
  }, [banners.length]);

  const order = useMemo(() => {
    if (banners.length === 0) return [];
    const rotated: Banner[] = [];
    for (let k = 0; k < banners.length; k++) rotated.push(banners[(activeIndex + k) % banners.length]);
    return rotated;
  }, [banners, activeIndex]);

  if (banners.length === 0) return null;

  const active = order[0];
  const tabs = order.slice(1);

  const abrirTopico = (banner: Banner) => {
    const telegramId = user?.id ? String(user.id) : "";
    if (telegramId) {
      api.registrarCliqueBanner({ telegramId, bannerId: banner.id }).catch(() => {});
    }
    navigate({
      to: "/empire-play/forum",
      search: { tab: banner.tab === "albuns" ? "albuns" : "musicas", id: banner.topicoId },
    });
  };

  return (
    <div className="mb-8">
      <div className="relative w-full" style={{ height: 116 }}>
        {tabs.map((tab, i) => {
          const right = 8 + i * (TAB_WIDTH + TAB_GAP);
          return (
            <button
              key={tab.id}
              onClick={() => setActiveIndex((activeIndex + 1 + i) % banners.length)}
              aria-label={`Ver banner de ${tab.artista}`}
              style={{
                position: "absolute",
                top: 6,
                bottom: 6,
                right,
                width: TAB_WIDTH,
                borderRadius: 8,
                overflow: "hidden",
                opacity: Math.max(0.35, 0.85 - i * 0.25),
                boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
                zIndex: 5 - i,
                transition: "all 260ms ease",
              }}
            >
              <img src={tab.imagemUrl} alt="" className="w-full h-full object-cover" />
            </button>
          );
        })}

        <button
          onClick={() => abrirTopico(active)}
          className="absolute inset-0 rounded-2xl overflow-hidden text-left"
          style={{ boxShadow: "0 8px 22px rgba(0,0,0,0.35)", transition: "all 260ms ease" }}
        >
          <img src={active.imagemUrl} alt="" className="absolute inset-0 w-full h-full object-cover" />
          <div
            className="absolute inset-0"
            style={{
              background: "linear-gradient(90deg, rgba(0,0,0,0.72) 0%, rgba(0,0,0,0.35) 55%, rgba(0,0,0,0.05) 100%)",
            }}
          />
          <div className="absolute top-2 left-3 text-[8px] font-black tracking-[0.08em] text-amber-200 bg-black/40 px-2 py-1 rounded-full">
            PATROCINADO
          </div>
          <div className="absolute left-3 bottom-2.5 right-16">
            <div className="text-[15px] font-black text-white leading-tight truncate">{active.titulo}</div>
            <div className="text-[11px] text-neutral-200 mt-0.5 truncate">{active.artista} · toque para ver o tópico</div>
          </div>
        </button>
      </div>

      {banners.length > 1 && (
        <div className="flex gap-1.5 justify-center mt-2">
          {banners.map((b, i) => (
            <div
              key={b.id}
              className="rounded-full transition-all"
              style={{
                width: i === activeIndex ? 16 : 5,
                height: 5,
                background: i === activeIndex ? "#d4af37" : "#3a4058",
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

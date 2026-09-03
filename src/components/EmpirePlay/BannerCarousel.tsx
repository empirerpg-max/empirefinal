import { useEffect, useState } from "react";
import { driveImgWide } from "@/lib/api";
import { haptic } from "@/lib/telegram";

interface Banner {
  id: string;
  imagem_url: string;
  link_destino?: string;
  legenda?: string;
  ordem: number;
}

const ROTATE_MS = 5000;

function goToBannerLink(link?: string) {
  if (!link) return;
  haptic.light();
  if (/^https?:\/\//i.test(link)) {
    window.open(link, "_blank", "noopener,noreferrer");
  } else {
    window.location.href = link.startsWith("/") ? link : `/${link}`;
  }
}

// Carrossel de banners promocionais no topo do Catálogo — substitui a antiga
// barra de perfil (avatar/Admin/nível), que só ocupava espaço sem utilidade.
// Cada banner é só imagem (16:6); a legenda vem de um pill discreto abaixo,
// e sem imagem cadastrada o banner simplesmente não existe (sem card vazio).
export function BannerCarousel() {
  const [banners, setBanners] = useState<Banner[]>([]);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    fetch("/api/social/banners")
      .then((res) => res.json())
      .then((data) => setBanners(Array.isArray(data) ? data : []))
      .catch(() => setBanners([]));
  }, []);

  useEffect(() => {
    if (banners.length < 2) return;
    const timer = setInterval(() => setIndex((i) => (i + 1) % banners.length), ROTATE_MS);
    return () => clearInterval(timer);
  }, [banners.length]);

  if (banners.length === 0) return null;

  const current = banners[index];

  return (
    <div className="w-full flex flex-col gap-2 mb-6">
      <button
        onClick={() => goToBannerLink(current.link_destino)}
        className="relative w-full aspect-[16/6] rounded-2xl overflow-hidden shadow-xl active:scale-[0.99] transition-transform"
      >
        {banners.map((b, i) => (
          <img
            key={b.id}
            src={driveImgWide(b.imagem_url, 1200)}
            alt=""
            referrerPolicy="no-referrer"
            className={`absolute inset-0 size-full object-cover transition-opacity duration-700 ${
              i === index ? "opacity-100" : "opacity-0"
            }`}
          />
        ))}
        {banners.length > 1 && (
          <div className="absolute bottom-2 right-2.5 flex gap-1 z-10">
            {banners.map((b, i) => (
              <span
                key={b.id}
                className={`h-1 rounded-full transition-all duration-300 ${
                  i === index ? "w-3 bg-primary" : "w-1 bg-white/40"
                }`}
              />
            ))}
          </div>
        )}
      </button>
      {current.legenda && (
        <button
          onClick={() => goToBannerLink(current.link_destino)}
          className="self-start flex items-center gap-1.5 rounded-full bg-white/[0.06] backdrop-blur-xl border border-white/10 px-3 py-1.5 text-[11px] font-semibold text-neutral-300 active:scale-95 transition-transform"
        >
          {current.legenda}
          {current.link_destino && <span className="text-primary font-bold">→</span>}
        </button>
      )}
    </div>
  );
}

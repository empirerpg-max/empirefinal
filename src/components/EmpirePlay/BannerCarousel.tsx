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
// A legenda (quando tem) vira um card de vidro sobreposto no canto
// inferior-esquerdo da própria imagem — pedido explícito do usuário pra
// ficar mais parecido com banners promocionais de apps reais (referência:
// card "Get 20% Off" com botão "Book Now"). Sem imagem cadastrada o banner
// simplesmente não existe (sem card vazio).
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
    <div className="w-full mb-6">
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

        {current.legenda && (
          <div className="absolute left-2.5 bottom-2.5 sm:left-3.5 sm:bottom-3.5 max-w-[78%] sm:max-w-[60%] rounded-xl sm:rounded-2xl bg-black/35 backdrop-blur-xl border border-white/15 shadow-lg px-3 py-2.5 sm:px-4 sm:py-3 flex flex-col items-start gap-1.5 sm:gap-2">
            <p className="text-[11px] sm:text-sm font-bold text-white leading-snug line-clamp-2">
              {current.legenda}
            </p>
            {current.link_destino && (
              <span className="inline-flex items-center gap-1 rounded-full bg-primary text-primary-foreground text-[9px] sm:text-[11px] font-black uppercase tracking-wide px-2.5 py-1 sm:px-3 sm:py-1.5">
                Ver agora
                <span className="translate-y-[-0.5px]">→</span>
              </span>
            )}
          </div>
        )}

        {banners.length > 1 && (
          <div className="absolute top-2.5 right-2.5 flex gap-1 z-10">
            {banners.map((b, i) => (
              <span
                key={b.id}
                className={`h-1 rounded-full transition-all duration-300 ${
                  i === index ? "w-3 bg-primary" : "w-1 bg-white/50"
                }`}
              />
            ))}
          </div>
        )}
      </button>
    </div>
  );
}

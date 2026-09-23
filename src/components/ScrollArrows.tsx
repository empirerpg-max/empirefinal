import { ChevronLeft, ChevronRight } from "lucide-react";

/**
 * Par de setas pra navegar listas horizontais no desktop (mouse/trackpad
 * sem touch). Ficam escondidas em telas touch via CSS (@media hover:hover
 * e pointer:fine), então no celular o comportamento nativo continua igual.
 */
export function ScrollArrows({
  canScrollLeft,
  canScrollRight,
  onScroll,
  className = "",
}: {
  canScrollLeft: boolean;
  canScrollRight: boolean;
  onScroll: (dir: -1 | 1) => void;
  className?: string;
}) {
  if (!canScrollLeft && !canScrollRight) return null;
  return (
    <>
      {canScrollLeft && (
        <button
          type="button"
          aria-label="Rolar para a esquerda"
          onClick={() => onScroll(-1)}
          className={`hscroll-arrow absolute left-0 top-1/2 -translate-y-1/2 z-10 size-8 rounded-full border border-white/10 bg-black/60 backdrop-blur-md grid place-items-center text-white/80 hover:text-white hover:bg-black/80 transition-all ${className}`}
        >
          <ChevronLeft className="size-4" />
        </button>
      )}
      {canScrollRight && (
        <button
          type="button"
          aria-label="Rolar para a direita"
          onClick={() => onScroll(1)}
          className={`hscroll-arrow absolute right-0 top-1/2 -translate-y-1/2 z-10 size-8 rounded-full border border-white/10 bg-black/60 backdrop-blur-md grid place-items-center text-white/80 hover:text-white hover:bg-black/80 transition-all ${className}`}
        >
          <ChevronRight className="size-4" />
        </button>
      )}
    </>
  );
}

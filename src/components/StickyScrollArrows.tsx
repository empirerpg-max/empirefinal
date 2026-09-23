import { ChevronLeft, ChevronRight } from "lucide-react";

/**
 * Par de setas pra ir dentro de uma fileira flex com overflow-x-auto,
 * como filhas comuns (sticky nas bordas do scroll) — não precisa
 * reestruturar a div existente com um wrapper novo. Só usar
 * `order-first`/`order-last` na hora de colocar no JSX.
 */
export function StickyScrollArrowLeft({
  show,
  onClick,
}: {
  show: boolean;
  onClick: () => void;
}) {
  if (!show) return null;
  return (
    <button
      type="button"
      aria-label="Rolar para a esquerda"
      onClick={onClick}
      className="hscroll-arrow sticky left-0 order-first z-10 self-center shrink-0 size-8 rounded-full border border-white/10 bg-black/60 backdrop-blur-md grid place-items-center text-white/80 hover:text-white hover:bg-black/80 transition-all"
    >
      <ChevronLeft className="size-4" />
    </button>
  );
}

export function StickyScrollArrowRight({
  show,
  onClick,
}: {
  show: boolean;
  onClick: () => void;
}) {
  if (!show) return null;
  return (
    <button
      type="button"
      aria-label="Rolar para a direita"
      onClick={onClick}
      className="hscroll-arrow sticky right-0 order-last z-10 self-center shrink-0 size-8 rounded-full border border-white/10 bg-black/60 backdrop-blur-md grid place-items-center text-white/80 hover:text-white hover:bg-black/80 transition-all"
    >
      <ChevronRight className="size-4" />
    </button>
  );
}

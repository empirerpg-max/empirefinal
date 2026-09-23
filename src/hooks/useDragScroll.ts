import { useEffect, useRef, useState, type RefObject } from "react";

/**
 * Rolagem horizontal por clique-e-arraste com o mouse (desktop), além de
 * touch/trackpad nativos. Também expõe se dá pra rolar mais pra
 * esquerda/direita, pra alimentar setas de navegação.
 *
 * Importante: NÃO usa setPointerCapture no container (mesmo motivo do
 * src/lib/useDragScroll.ts) — isso retargeta todo evento de ponteiro
 * subsequente pro próprio container e quebra clique em filhos (botões).
 * Em vez disso, escuta pointermove/pointerup no window enquanto arrasta.
 */
export function useDragScroll<T extends HTMLElement>(): {
  ref: RefObject<T | null>;
  canScrollLeft: boolean;
  canScrollRight: boolean;
  scrollByAmount: (dir: -1 | 1) => void;
} {
  const ref = useRef<T | null>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const dragState = useRef({ dragging: false, startX: 0, startScroll: 0, moved: false });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const updateEdges = () => {
      setCanScrollLeft(el.scrollLeft > 4);
      setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
    };
    updateEdges();

    const onWindowPointerMove = (e: PointerEvent) => {
      if (!dragState.current.dragging) return;
      const delta = e.clientX - dragState.current.startX;
      if (Math.abs(delta) > 3) dragState.current.moved = true;
      el.scrollLeft = dragState.current.startScroll - delta;
    };
    const onWindowPointerUp = () => {
      dragState.current.dragging = false;
      window.removeEventListener("pointermove", onWindowPointerMove);
      window.removeEventListener("pointerup", onWindowPointerUp);
    };
    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      dragState.current = { dragging: true, startX: e.clientX, startScroll: el.scrollLeft, moved: false };
      window.addEventListener("pointermove", onWindowPointerMove);
      window.addEventListener("pointerup", onWindowPointerUp);
    };
    // Evita disparar o onClick de um filho logo depois de um drag de verdade.
    const onClickCapture = (e: MouseEvent) => {
      if (dragState.current.moved) {
        e.preventDefault();
        e.stopPropagation();
        dragState.current.moved = false;
      }
    };

    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("click", onClickCapture, true);
    el.addEventListener("scroll", updateEdges, { passive: true });
    const resizeObserver = new ResizeObserver(updateEdges);
    resizeObserver.observe(el);

    return () => {
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("click", onClickCapture, true);
      el.removeEventListener("scroll", updateEdges);
      resizeObserver.disconnect();
      window.removeEventListener("pointermove", onWindowPointerMove);
      window.removeEventListener("pointerup", onWindowPointerUp);
    };
  }, []);

  const scrollByAmount = (dir: -1 | 1) => {
    const el = ref.current;
    if (!el) return;
    el.scrollBy({ left: dir * el.clientWidth * 0.7, behavior: "smooth" });
  };

  return { ref, canScrollLeft, canScrollRight, scrollByAmount };
}

import { useCallback, useEffect, useState } from "react";

/**
 * Rolagem horizontal por clique-e-arraste com o mouse (desktop), além de
 * touch/trackpad nativos. Também expõe se dá pra rolar mais pra
 * esquerda/direita, pra alimentar setas de navegação.
 *
 * Importante: NÃO usa setPointerCapture no container (mesmo motivo do
 * antigo src/lib/useDragScroll.ts) — isso retargeta todo evento de
 * ponteiro subsequente pro próprio container e quebra clique em filhos
 * (botões). Em vez disso, escuta pointermove/pointerup no window enquanto
 * arrasta.
 *
 * `ref` é um callback ref (não um useRef comum) de propósito: várias
 * dessas fileiras só aparecem depois que os dados chegam (loading async),
 * então o elemento não existe ainda no primeiro render — um useRef comum
 * nunca reconectaria os listeners quando ele finalmente aparecesse.
 */
export function useDragScroll<T extends HTMLElement>(): {
  ref: (node: T | null) => void;
  canScrollLeft: boolean;
  canScrollRight: boolean;
  scrollByAmount: (dir: -1 | 1) => void;
} {
  const [node, setNode] = useState<T | null>(null);
  const ref = useCallback((n: T | null) => setNode(n), []);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  useEffect(() => {
    const el = node;
    if (!el) return;

    const updateEdges = () => {
      setCanScrollLeft(el.scrollLeft > 4);
      setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
    };
    updateEdges();

    const dragState = { dragging: false, startX: 0, startScroll: 0, moved: false };

    const onWindowPointerMove = (e: PointerEvent) => {
      if (!dragState.dragging) return;
      const delta = e.clientX - dragState.startX;
      if (Math.abs(delta) > 3) dragState.moved = true;
      el.scrollLeft = dragState.startScroll - delta;
    };
    const onWindowPointerUp = () => {
      dragState.dragging = false;
      window.removeEventListener("pointermove", onWindowPointerMove);
      window.removeEventListener("pointerup", onWindowPointerUp);
    };
    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      // Sem isso, clicar sobre uma <img> dispara o drag nativo do
      // navegador (a "imagem fantasma" seguindo o cursor) em vez do nosso
      // scroll — e o pointermove some enquanto esse drag nativo dura.
      e.preventDefault();
      dragState.dragging = true;
      dragState.startX = e.clientX;
      dragState.startScroll = el.scrollLeft;
      dragState.moved = false;
      window.addEventListener("pointermove", onWindowPointerMove);
      window.addEventListener("pointerup", onWindowPointerUp);
    };
    // Evita disparar o onClick de um filho logo depois de um drag de verdade.
    const onClickCapture = (e: MouseEvent) => {
      if (dragState.moved) {
        e.preventDefault();
        e.stopPropagation();
        dragState.moved = false;
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
  }, [node]);

  const scrollByAmount = (dir: -1 | 1) => {
    if (!node) return;
    node.scrollBy({ left: dir * node.clientWidth * 0.7, behavior: "smooth" });
  };

  return { ref, canScrollLeft, canScrollRight, scrollByAmount };
}

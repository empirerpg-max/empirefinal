import { useRef } from "react";

// Permite "arrastar" um container com overflow-x tanto no touch (nativo)
// quanto no mouse (desktop/preview) — sem isso, um scroller com a barra
// escondida fica sem nenhuma forma de navegar via mouse.
//
// Importante: NÃO usa setPointerCapture no container. Isso retargeta todo
// evento de ponteiro subsequente (inclusive o "click") pro próprio
// container, então os cliques nos filhos (botões) nunca chegam a disparar
// — foi exatamente esse bug que travava a seleção de artista sempre no
// primeiro item. Em vez disso, escuta pointermove/pointerup no window
// enquanto o drag está ativo.
export function useDragScroll<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const state = useRef({ dragging: false, startX: 0, startScroll: 0, moved: false });

  function onPointerDown(e: React.PointerEvent) {
    const el = ref.current;
    if (!el || e.pointerType === "touch") return;
    state.current = { dragging: true, startX: e.clientX, startScroll: el.scrollLeft, moved: false };
    window.addEventListener("pointermove", onWindowPointerMove);
    window.addEventListener("pointerup", onWindowPointerUp);
  }

  function onWindowPointerMove(e: PointerEvent) {
    const el = ref.current;
    if (!el || !state.current.dragging) return;
    const delta = e.clientX - state.current.startX;
    if (Math.abs(delta) > 3) state.current.moved = true;
    el.scrollLeft = state.current.startScroll - delta;
  }

  function onWindowPointerUp() {
    state.current.dragging = false;
    window.removeEventListener("pointermove", onWindowPointerMove);
    window.removeEventListener("pointerup", onWindowPointerUp);
  }

  // Evita disparar o onClick de um botão logo depois de um drag de verdade.
  function onClickCapture(e: React.MouseEvent) {
    if (state.current.moved) {
      e.preventDefault();
      e.stopPropagation();
      state.current.moved = false;
    }
  }

  return {
    ref,
    dragProps: {
      onPointerDown,
      onClickCapture,
    },
  };
}

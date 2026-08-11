import { useRef } from "react";

// Permite "arrastar" um container com overflow-x tanto no touch (nativo)
// quanto no mouse (desktop/preview) — sem isso, um scroller com a barra
// escondida fica sem nenhuma forma de navegar via mouse.
export function useDragScroll<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const state = useRef({ dragging: false, startX: 0, startScroll: 0, moved: false });

  function onPointerDown(e: React.PointerEvent) {
    const el = ref.current;
    if (!el || e.pointerType === "touch") return;
    state.current = { dragging: true, startX: e.clientX, startScroll: el.scrollLeft, moved: false };
    el.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    const el = ref.current;
    if (!el || !state.current.dragging) return;
    const delta = e.clientX - state.current.startX;
    if (Math.abs(delta) > 3) state.current.moved = true;
    el.scrollLeft = state.current.startScroll - delta;
  }

  function onPointerUp(e: React.PointerEvent) {
    const el = ref.current;
    state.current.dragging = false;
    if (el) el.releasePointerCapture(e.pointerId);
  }

  // Evita disparar o onClick de um botão logo depois de um drag.
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
      onPointerMove,
      onPointerUp,
      onPointerLeave: onPointerUp,
      onClickCapture,
    },
  };
}

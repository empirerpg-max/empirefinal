import { useCallback, useEffect, useRef, useState } from "react";

// Gesto de uma mensagem do chat: arrastar para a esquerda = responder;
// segurar parado = menu (Responder / Copiar texto).

export type EntradaGesto = { dx: number; dy: number; ms: number; moveuVertical: boolean };
export type DecisaoGesto = "responder" | "menu" | "nada";

/** Deslocamento (px) a partir do qual um toque deixa de ser "parado". */
export const TOLERANCIA_PARADO_PX = 10;
export const DESLOCAMENTO_MAX_PX = 70;

/** Decide o que o gesto significa. Pura (testada em scripts/tv-chat-gestos.test.ts). */
export function decidirGesto(
  { dx, dy, ms, moveuVertical }: EntradaGesto,
  limitePx = 50,
  longoMs = 500,
): DecisaoGesto {
  // Movimento vertical domina = o usuário está rolando o chat.
  if (moveuVertical || Math.abs(dy) > Math.abs(dx) * 1.2 && Math.abs(dy) > TOLERANCIA_PARADO_PX) return "nada";
  if (dx <= -limitePx) return "responder";
  if (ms >= longoMs && Math.abs(dx) <= TOLERANCIA_PARADO_PX && Math.abs(dy) <= TOLERANCIA_PARADO_PX) return "menu";
  return "nada";
}

/** Quanto a mensagem aparece deslocada: só para a esquerda, até 70 px. */
export function deslocamentoVisivel(dx: number): number {
  if (!(dx < 0)) return 0;
  return Math.max(-DESLOCAMENTO_MAX_PX, dx);
}

/**
 * Handlers de pointer para uma linha de mensagem. Só toque/caneta arrasta ou
 * segura (mouse usa o botão e o clique direito). A linha deve ter
 * `touch-action: pan-y` (vem em `style`) para a rolagem vertical continuar
 * do navegador; assim que o vertical domina o gesto é cancelado.
 */
export function useArrastarParaResponder(
  onResponder: () => void,
  onMenu: (pos: { x: number; y: number }) => void,
  limitePx = 50,
) {
  const [dx, setDx] = useState(0);
  const [ativo, setAtivo] = useState(false);
  const est = useRef<{ id: number; x0: number; y0: number; t0: number; dx: number; dy: number; vert: boolean; menu: boolean } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cbs = useRef({ onResponder, onMenu });
  cbs.current = { onResponder, onMenu };

  const limpaTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const encerrar = useCallback(() => {
    limpaTimer();
    est.current = null;
    setDx(0);
    setAtivo(false);
  }, []);
  useEffect(() => limpaTimer, []);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === "mouse" || (e.target as HTMLElement).closest("button,a,video")) return;
    est.current = { id: e.pointerId, x0: e.clientX, y0: e.clientY, t0: Date.now(), dx: 0, dy: 0, vert: false, menu: false };
    setAtivo(true);
    limpaTimer();
    const x = e.clientX, y = e.clientY;
    timer.current = setTimeout(() => {
      const s = est.current;
      if (!s) return;
      if (decidirGesto({ dx: s.dx, dy: s.dy, ms: 500, moveuVertical: s.vert }, limitePx) === "menu") {
        s.menu = true;
        try { navigator.vibrate?.(10); } catch { /* sem vibração */ }
        cbs.current.onMenu({ x, y });
        setDx(0);
      }
    }, 500);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const s = est.current;
    if (!s || s.id !== e.pointerId || s.menu) return;
    s.dx = e.clientX - s.x0;
    s.dy = e.clientY - s.y0;
    if (Math.abs(s.dy) > TOLERANCIA_PARADO_PX && Math.abs(s.dy) > Math.abs(s.dx) * 1.2) {
      s.vert = true;
      encerrar();
      return;
    }
    if (Math.abs(s.dx) > TOLERANCIA_PARADO_PX || Math.abs(s.dy) > TOLERANCIA_PARADO_PX) limpaTimer();
    setDx(deslocamentoVisivel(s.dx));
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const s = est.current;
    if (!s || s.id !== e.pointerId) return;
    const r = s.menu ? "nada" : decidirGesto({ dx: s.dx, dy: s.dy, ms: Date.now() - s.t0, moveuVertical: s.vert }, limitePx);
    encerrar();
    if (r === "responder") cbs.current.onResponder();
  };

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault(); // evita o menu nativo (toque longo no Android / botão direito)
    if (est.current?.menu) return;
    cbs.current.onMenu({ x: e.clientX, y: e.clientY });
  };

  return {
    deslocamento: dx,
    ativo,
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: encerrar, onContextMenu },
    // pan-y: rolagem vertical segue normal; durante o gesto, sem seleção/callout do iOS.
    style: {
      touchAction: "pan-y",
      ...(ativo ? { userSelect: "none", WebkitUserSelect: "none", WebkitTouchCallout: "none" } : {}),
    } as React.CSSProperties,
  };
}

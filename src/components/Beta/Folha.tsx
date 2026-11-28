import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";
import { useHistoryOverlay } from "@/hooks/useHistoryOverlay";

/**
 * Folha de baixo das telas do Beta: fundo escurecido, ✕ no canto, tocar fora
 * e Esc fecham, voltar do celular fecha só esta folha (`useHistoryOverlay`).
 * z-[300] como o ActionSheet (acima do topo z-[60] e do toaster).
 * `children` recebe `fechar` para ações que fecham a folha.
 */
export function Folha({
  aberto,
  titulo,
  aoFechar,
  children,
}: {
  aberto: boolean;
  titulo: string;
  aoFechar: () => void;
  children: (fechar: (depois?: () => void) => void) => ReactNode;
}) {
  const { fechar } = useHistoryOverlay(aberto, aoFechar);
  const [montado, setMontado] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => setMontado(true), []);

  // Foco na folha só ao abrir (efeito passivo, não ref callback); ao fechar
  // devolve o foco a quem tinha (assim o Esc segue valendo na folha de baixo).
  useEffect(() => {
    if (!aberto || !montado) return;
    const antes = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    ref.current?.focus({ preventScroll: true });
    return () => {
      if (antes && antes.isConnected) antes.focus({ preventScroll: true });
    };
  }, [aberto, montado]);

  if (!montado) return null;
  return createPortal(
    <AnimatePresence>
      {aberto && (
        <div key="folha" className="fixed inset-0 z-[300] flex items-end sm:items-center justify-center">
          <motion.div
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => fechar()}
            aria-hidden="true"
          />
          <motion.div
            ref={ref}
            role="dialog"
            aria-modal="true"
            aria-label={titulo}
            tabIndex={-1}
            onKeyDown={(ev) => {
              if (ev.key === "Escape") {
                ev.stopPropagation();
                fechar();
              }
            }}
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "tween", duration: 0.22, ease: "easeOut" }}
            className="relative w-full sm:max-w-sm max-h-[90dvh] overflow-y-auto rounded-t-[1.75rem] sm:rounded-[1.75rem] border-t sm:border border-border bg-background text-foreground shadow-2xl px-4 pt-3 outline-none"
            style={{ paddingBottom: "calc(1rem + env(safe-area-inset-bottom))" }}
          >
            <div className="flex items-center gap-2 mb-3">
              <b className="min-w-0 flex-1 truncate px-1 text-base font-bold">{titulo}</b>
              <button
                type="button"
                aria-label="Fechar"
                onClick={() => fechar()}
                className="shrink-0 size-10 grid place-items-center rounded-full bg-muted text-foreground active:scale-95 transition-transform"
              >
                <X className="size-5 shrink-0" />
              </button>
            </div>
            {children(fechar)}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

import { useEffect, useRef, useState } from "react";
import { X, ChevronLeft, ChevronRight } from "lucide-react";
import { SmartImg } from "@/components/SmartImg";

interface EncarteViewerProps {
  paginas: string[];
  indiceInicial: number;
  onClose: () => void;
}

/**
 * Visualizador de encarte em tela cheia, dentro do próprio app — antes cada
 * imagem abria como um link solto em nova aba (pedido explícito desde o
 * início pra ser uma experiência de "folhear páginas", não um link à
 * parte). Rolagem horizontal com snap por página (funciona com swipe do
 * dedo igual um app de leitura de verdade) + setas/tecla de seta pra
 * navegar sem precisar arrastar.
 */
export function EncarteViewer({ paginas, indiceInicial, onClose }: EncarteViewerProps) {
  const [pagina, setPagina] = useState(indiceInicial);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTo({ left: indiceInicial * el.clientWidth, behavior: "instant" as ScrollBehavior });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function irPara(i: number) {
    const clamped = Math.max(0, Math.min(paginas.length - 1, i));
    setPagina(clamped);
    const el = scrollerRef.current;
    if (el) el.scrollTo({ left: clamped * el.clientWidth, behavior: "smooth" });
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowRight") irPara(pagina + 1);
      else if (e.key === "ArrowLeft") irPara(pagina - 1);
      else if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagina]);

  return (
    <div className="fixed inset-0 z-[200] bg-black flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-4 pt-[calc(env(safe-area-inset-top)+12px)] pb-3">
        <span className="text-xs font-black uppercase tracking-wide text-white/70">
          Encarte · {pagina + 1}/{paginas.length}
        </span>
        <button
          onClick={onClose}
          className="size-8 rounded-full bg-white/10 grid place-items-center text-white"
          aria-label="Fechar"
        >
          <X className="size-4" />
        </button>
      </div>

      <div
        ref={scrollerRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          if (el.clientWidth > 0) setPagina(Math.round(el.scrollLeft / el.clientWidth));
        }}
        className="flex-1 flex overflow-x-auto snap-x snap-mandatory [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
      >
        {paginas.map((url, i) => (
          <div key={i} className="w-full h-full shrink-0 snap-center grid place-items-center px-2">
            <SmartImg
              src={url}
              size={1600}
              alt={`Encarte, página ${i + 1}`}
              className="max-w-full max-h-full object-contain"
              fallback={
                <p className="text-xs text-white/50">Não foi possível carregar essa página.</p>
              }
            />
          </div>
        ))}
      </div>

      {pagina > 0 && (
        <button
          onClick={() => irPara(pagina - 1)}
          className="absolute left-2 top-1/2 -translate-y-1/2 size-9 rounded-full bg-white/10 text-white grid place-items-center"
          aria-label="Página anterior"
        >
          <ChevronLeft className="size-4" />
        </button>
      )}
      {pagina < paginas.length - 1 && (
        <button
          onClick={() => irPara(pagina + 1)}
          className="absolute right-2 top-1/2 -translate-y-1/2 size-9 rounded-full bg-white/10 text-white grid place-items-center"
          aria-label="Próxima página"
        >
          <ChevronRight className="size-4" />
        </button>
      )}

      <div className="flex items-center justify-center gap-1.5 pb-[calc(env(safe-area-inset-bottom)+16px)] pt-3">
        {paginas.map((_, i) => (
          <button
            key={i}
            onClick={() => irPara(i)}
            className={`h-1.5 rounded-full transition-all ${
              i === pagina ? "w-5 bg-white" : "w-1.5 bg-white/30"
            }`}
            aria-label={`Ir pra página ${i + 1}`}
          />
        ))}
      </div>
    </div>
  );
}

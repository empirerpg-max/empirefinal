import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useDragScroll } from "@/hooks/useDragScroll";
import { cn } from "@/lib/utils";
import { FAIXA_SETA, destinoDaPagina, scrollParaMostrar } from "@/lib/scrollRow";

/**
 * Fileira rolável na horizontal com setas (spec 6.1) — a base de toda barra
 * de abas/filtros do Beta. Junta o `useDragScroll` (arrastar com o mouse +
 * toque/trackpad nativos) com as setas em faixa própria.
 *
 * Como usar: cada filho DIRETO precisa de `data-scroll-item={id}` (o id é o
 * que vai em `selecionado`). Os itens são responsabilidade de quem usa:
 * `shrink-0` + padding real (≥ `px-1`) e o texto INTEIRO — nunca `truncate`
 * nem `min-w-0` num item desta fileira (regra do CLAUDE.md: aba nunca
 * aparece cortada com "…"; quem não cabe, rola).
 *
 * - Seta só do lado que ainda tem conteúdo, numa faixa de 56 px com degradê
 *   da cor do fundo; a faixa não bloqueia toque nos itens (só o botão).
 * - Toque na seta avança "uma página" (largura − as duas faixas) e para no
 *   começo de um item (`scroll-snap` + `scroll-padding` = faixa).
 * - `selecionado` sempre fica inteiro entre as faixas: ao montar (sem
 *   animação) e ao trocar (suave, ou sem animação com reduced-motion).
 * - Teclado: ←/→ (e Home/End) com o foco dentro movem o foco entre itens.
 */
export function ScrollRow({
  children,
  selecionado,
  rotulo,
  className,
}: {
  children: ReactNode;
  selecionado?: string;
  rotulo: string;
  className?: string;
}) {
  const drag = useDragScroll<HTMLDivElement>();
  const [no, setNo] = useState<HTMLDivElement | null>(null);
  const refFileira = useCallback(
    (n: HTMLDivElement | null) => {
      drag.ref(n);
      setNo(n);
    },
    [drag.ref],
  );

  const itens = useCallback(
    (el: HTMLElement) =>
      Array.from(el.children).filter(
        (c): c is HTMLElement => c instanceof HTMLElement && c.hasAttribute("data-scroll-item"),
      ),
    [],
  );

  // Arrastar com o mouse mexe em scrollLeft a cada movimento; com snap ligado
  // o navegador puxaria para o item mais perto no meio do arraste. Desliga o
  // snap enquanto o botão do mouse está apertado (o arraste em si continua
  // todo no useDragScroll).
  useEffect(() => {
    const el = no;
    if (!el) return;
    const soltar = () => {
      el.style.scrollSnapType = "";
      window.removeEventListener("pointerup", soltar);
    };
    const apertar = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      el.style.scrollSnapType = "none";
      window.addEventListener("pointerup", soltar);
    };
    el.addEventListener("pointerdown", apertar);
    // O useDragScroll só reavalia as setas no scroll e quando a fileira muda
    // de tamanho; quando os ITENS mudam de largura (texto trocado, item
    // novo), avisa com um "scroll" sintético.
    const avisar = () => el.dispatchEvent(new Event("scroll"));
    const ro = new ResizeObserver(avisar);
    const observar = () => {
      ro.disconnect();
      ro.observe(el);
      for (const item of itens(el)) ro.observe(item);
    };
    observar();
    const mo = new MutationObserver(() => {
      observar();
      avisar();
    });
    mo.observe(el, { childList: true });
    return () => {
      el.removeEventListener("pointerdown", apertar);
      window.removeEventListener("pointerup", soltar);
      ro.disconnect();
      mo.disconnect();
    };
  }, [no, itens]);

  const semAnimacao = () =>
    typeof window !== "undefined" &&
    !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  const mostrarItem = useCallback(
    (item: HTMLElement, suave: boolean) => {
      const el = no;
      if (!el) return;
      const destino = scrollParaMostrar(
        item.offsetLeft,
        item.offsetLeft + item.offsetWidth,
        el.scrollLeft,
        el.clientWidth,
      );
      if (destino === null) return;
      el.scrollTo({ left: destino, behavior: suave && !semAnimacao() ? "smooth" : "auto" });
    },
    [no],
  );

  // Selecionado sempre inteiro na tela. A primeira vez que o item existe é
  // instantâneo (a fileira já abre no lugar); trocas depois são suaves.
  const jaMostrou = useRef(false);
  useEffect(() => {
    const el = no;
    if (!el || selecionado === undefined) return;
    const item = itens(el).find((c) => c.getAttribute("data-scroll-item") === selecionado);
    if (!item) return;
    mostrarItem(item, jaMostrou.current);
    jaMostrou.current = true;
  }, [no, selecionado, itens, mostrarItem]);

  const rolarPagina = (dir: -1 | 1) => {
    const el = no;
    if (!el) return;
    const inicios = itens(el).map((c) => Math.max(c.offsetLeft - FAIXA_SETA, 0));
    const destino = destinoDaPagina(dir, el.scrollLeft, el.clientWidth, inicios);
    el.scrollTo({ left: destino, behavior: semAnimacao() ? "auto" : "smooth" });
  };

  const aoTeclar = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    const el = no;
    if (!el) return;
    const lista = itens(el);
    const atual = lista.findIndex((c) => c.contains(document.activeElement));
    if (atual === -1) return;
    let alvo = atual;
    if (e.key === "ArrowLeft") alvo = atual - 1;
    else if (e.key === "ArrowRight") alvo = atual + 1;
    else if (e.key === "Home") alvo = 0;
    else alvo = lista.length - 1;
    if (alvo < 0 || alvo >= lista.length || alvo === atual) return;
    const item = lista[alvo];
    const focavel = item.matches(FOCAVEL) ? item : item.querySelector<HTMLElement>(FOCAVEL);
    if (!focavel) return;
    e.preventDefault();
    focavel.focus({ preventScroll: true });
    mostrarItem(item, true);
  };

  return (
    <div className={cn("relative", className)}>
      <div
        ref={refFileira}
        role="group"
        aria-label={rotulo}
        onKeyDown={aoTeclar}
        className="relative flex overflow-x-auto scrollbar-hide snap-x snap-proximity cursor-grab active:cursor-grabbing select-none [&>[data-scroll-item]]:snap-start"
        style={{ scrollPaddingInline: FAIXA_SETA }}
      >
        {children}
      </div>
      {drag.canScrollLeft && <FaixaSeta lado="esquerda" onClick={() => rolarPagina(-1)} />}
      {drag.canScrollRight && <FaixaSeta lado="direita" onClick={() => rolarPagina(1)} />}
    </div>
  );
}

const FOCAVEL =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Faixa de 56 px colada na borda, com degradê do fundo para transparente.
 * A faixa ignora o ponteiro (os itens embaixo continuam clicáveis/arrastáveis);
 * só o botão de 44×44 (círculo visível de 32 px) recebe o toque.
 */
function FaixaSeta({ lado, onClick }: { lado: "esquerda" | "direita"; onClick: () => void }) {
  const esquerda = lado === "esquerda";
  const Icone = esquerda ? ChevronLeft : ChevronRight;
  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-y-0 z-10 flex items-center",
        esquerda
          ? "left-0 justify-start bg-[linear-gradient(90deg,var(--background)_55%,transparent)]"
          : "right-0 justify-end bg-[linear-gradient(270deg,var(--background)_55%,transparent)]",
      )}
      style={{ width: FAIXA_SETA }}
    >
      <button
        type="button"
        tabIndex={-1}
        aria-label={esquerda ? "Rolar para a esquerda" : "Rolar para a direita"}
        onClick={onClick}
        className="pointer-events-auto grid size-11 shrink-0 place-items-center"
      >
        <span className="grid size-8 place-items-center rounded-full border border-white/10 bg-black/60 text-white/80 shadow-[0_2px_8px_rgba(0,0,0,0.3)] backdrop-blur-md transition-colors hover:bg-black/80 hover:text-white">
          <Icone className="size-4 shrink-0" />
        </span>
      </button>
    </div>
  );
}

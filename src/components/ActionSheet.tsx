import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { useHistoryOverlay } from "@/hooks/useHistoryOverlay";
import { ordenarAcoes, type AcaoMenu } from "@/lib/acoesMenu";

export type { AcaoMenu } from "@/lib/acoesMenu";

// Trava a rolagem do body enquanto houver pelo menos uma folha aberta
// (contador: folha por cima de folha não destrava cedo demais).
let travas = 0;
let overflowAntes = "";
function travarRolagem(): () => void {
  if (travas === 0) {
    overflowAntes = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  travas++;
  return () => {
    travas--;
    if (travas === 0) document.body.style.overflow = overflowAntes;
  };
}

const FOCAVEIS = 'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

/**
 * Menu ⋯ como folha de baixo (spec 6.3), compartilhado pelas telas Beta.
 *
 * - Fundo escurecido clicável, X implícito pelo "Cancelar", Esc e o voltar
 *   do celular fecham (voltar = tela anterior, via `useHistoryOverlay`).
 * - Ações na ordem dada, destrutivas em vermelho e por último
 *   (`ordenarAcoes`).
 * - Foco vai para a folha ao abrir e volta para quem estava focado (o botão
 *   ⋯) ao fechar; Tab fica preso dentro da folha.
 *
 * Contrato do `aoEscolher`: escolher uma ação chama `fechar()` e, no MESMO
 * toque (síncrono, sem await/setTimeout no meio), `aoEscolher()`. Assim a
 * entrada desta folha sai do histórico antes de a ação navegar e, se a ação
 * abrir outra folha, a nova reaproveita a entrada desta (sem entrada órfã).
 * aoEscolher roda no mesmo toque; se abrir outra folha, abra de forma
 * síncrona (abrir depois de um await não é coordenado com o go() do
 * histórico ainda em voo).
 *
 * SSR-safe: só renderiza (portal no document.body) depois de montar no cliente.
 */
export function ActionSheet({
  aberto,
  titulo,
  acoes,
  aoFechar,
}: {
  aberto: boolean;
  titulo?: string;
  acoes: AcaoMenu[];
  aoFechar: () => void;
}) {
  const { fechar } = useHistoryOverlay(aberto, aoFechar);
  const [montado, setMontado] = useState(false);
  const folhaRef = useRef<HTMLDivElement>(null);
  // Durante a animação de saída o AnimatePresence mantém os filhos do último
  // render (com aberto=true); o ref diz a verdade e ignora toques nessa hora.
  const abertoRef = useRef(aberto);
  abertoRef.current = aberto;

  useEffect(() => setMontado(true), []);

  // Foco + trava de rolagem enquanto aberta. A limpeza (restaurar o foco)
  // roda antes dos efeitos de uma folha que abra no mesmo commit, então a
  // nova folha fica com o foco.
  useEffect(() => {
    if (!aberto || !montado) return;
    const antes = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const destravar = travarRolagem();
    folhaRef.current?.focus({ preventScroll: true });
    return () => {
      destravar();
      if (antes && antes.isConnected) antes.focus({ preventScroll: true });
    };
  }, [aberto, montado]);

  if (!montado) return null;

  const rotulo = titulo || "Opções";
  const lista = ordenarAcoes(acoes);

  const aoTeclar = (ev: KeyboardEvent<HTMLDivElement>) => {
    if (ev.key === "Escape") {
      ev.stopPropagation();
      ev.preventDefault();
      if (abertoRef.current) fechar();
      return;
    }
    if (ev.key !== "Tab" || !folhaRef.current) return;
    const focaveis = Array.from(folhaRef.current.querySelectorAll<HTMLElement>(FOCAVEIS));
    if (focaveis.length === 0) return;
    const primeiro = focaveis[0];
    const ultimo = focaveis[focaveis.length - 1];
    const atual = document.activeElement;
    if (ev.shiftKey && (atual === primeiro || atual === folhaRef.current)) {
      ev.preventDefault();
      ultimo.focus();
    } else if (!ev.shiftKey && atual === ultimo) {
      ev.preventDefault();
      primeiro.focus();
    }
  };

  return createPortal(
    <AnimatePresence>
      {aberto && (
        <div className="fixed inset-0 z-[300] flex items-end sm:items-center justify-center">
          <motion.div
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => abertoRef.current && fechar()}
            aria-hidden="true"
          />
          <motion.div
            ref={folhaRef}
            role="dialog"
            aria-modal="true"
            aria-label={rotulo}
            tabIndex={-1}
            onKeyDown={aoTeclar}
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "tween", duration: 0.22, ease: "easeOut" }}
            className="relative w-full sm:max-w-sm max-h-[85dvh] overflow-y-auto rounded-t-[1.75rem] sm:rounded-[1.75rem] border-t sm:border border-border bg-background text-foreground shadow-2xl px-4 pt-2 outline-none"
            style={{ paddingBottom: "calc(1rem + env(safe-area-inset-bottom))" }}
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-muted-foreground/40" aria-hidden="true" />
            {titulo && <b className="block min-w-0 truncate px-1 mb-2 text-base font-bold">{titulo}</b>}

            {lista.length > 0 && (
              <div className="rounded-2xl bg-muted/40 border border-border overflow-hidden divide-y divide-border">
                {lista.map((acao) => {
                  const Icone = acao.icone;
                  return (
                    <button
                      key={acao.id}
                      type="button"
                      onClick={() => {
                        // Mesmo toque, nesta ordem: fecha (entrada do histórico
                        // sai) e só então a ação. Nada assíncrono no meio.
                        if (!abertoRef.current) return;
                        abertoRef.current = false;
                        fechar();
                        acao.aoEscolher();
                      }}
                      className={`w-full min-w-0 min-h-11 flex items-center gap-3 px-3 py-2 text-left active:bg-muted transition-colors ${
                        acao.destrutiva ? "text-destructive" : "text-foreground"
                      }`}
                    >
                      {Icone && (
                        <span className="size-9 shrink-0 rounded-xl bg-muted grid place-items-center">
                          <Icone className="size-[18px] shrink-0" />
                        </span>
                      )}
                      <span className="min-w-0 flex-1 truncate text-sm font-bold">{acao.rotulo}</span>
                    </button>
                  );
                })}
              </div>
            )}

            <button
              type="button"
              onClick={() => abertoRef.current && fechar()}
              className="mt-3 w-full min-w-0 min-h-11 px-3 rounded-2xl bg-muted text-foreground text-sm font-bold active:scale-[0.98] transition-transform"
            >
              <span className="block truncate">Cancelar</span>
            </button>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

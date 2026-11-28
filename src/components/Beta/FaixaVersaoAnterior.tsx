import { useState } from "react";
import { toast } from "sonner";
import { mostrarFaixa } from "@/lib/beta/regras";
import { useBeta } from "@/hooks/useBeta";
import { FolhaReportar } from "./FolhaReportar";

/** Altura da faixa (px): o `padding-top` do conteúdo soma isto quando ela aparece. */
export const ALTURA_FAIXA = 32;

/** Faixa fixa logo abaixo do topo, só na versão anterior para quem pode ver o Beta. */
export function FaixaVersaoAnterior() {
  const { estado, trocarVersao } = useBeta();
  const [reportando, setReportando] = useState(false);
  const [trocando, setTrocando] = useState(false);
  if (!mostrarFaixa(estado)) return null;
  return (
    <>
      <div
        className="fixed inset-x-0 z-[59] flex items-center gap-1.5 px-3 border-b border-white/[0.06] bg-muted text-foreground text-xs"
        style={{ top: "calc(4rem + env(safe-area-inset-top))", height: ALTURA_FAIXA }}
      >
        <span className="min-w-0 flex-1 truncate font-bold">Versão anterior</span>
        <button
          type="button"
          onClick={() => setReportando(true)}
          className="shrink-0 whitespace-nowrap rounded-full border border-white/15 px-2 py-1 font-bold leading-4 active:scale-95 transition-transform"
        >
          Reportar
        </button>
        <button
          type="button"
          disabled={trocando}
          onClick={async () => {
            setTrocando(true);
            const ok = await trocarVersao("beta");
            setTrocando(false);
            if (!ok) toast.error("Não deu para abrir o Beta agora. Tente de novo.");
          }}
          className="shrink-0 whitespace-nowrap rounded-full bg-foreground px-2 py-1 font-bold leading-4 text-background disabled:opacity-50 active:scale-95 transition-transform"
        >
          Ir para o Beta test
        </button>
      </div>
      <FolhaReportar aberto={reportando} aoFechar={() => setReportando(false)} />
    </>
  );
}

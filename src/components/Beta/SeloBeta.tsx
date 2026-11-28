import { useState } from "react";
import { mostrarSelo } from "@/lib/beta/regras";
import { useBeta } from "@/hooks/useBeta";
import { FolhaBeta } from "./FolhaBeta";

/** Pílula amarela "BETA" ao lado do logo; abre a FolhaBeta. Alvo de toque de 40 px. */
export function SeloBeta() {
  const { estado } = useBeta();
  const [aberta, setAberta] = useState(false);
  if (!mostrarSelo(estado)) return null;
  return (
    <>
      <button
        type="button"
        aria-label="Beta test: abrir opções"
        onClick={() => setAberta(true)}
        className="shrink-0 min-h-10 min-w-10 px-2 grid place-items-center active:scale-95 transition-transform"
      >
        <span className="rounded-full bg-amber-400 px-2.5 py-0.5 text-[11px] font-black leading-4 tracking-wider text-black">
          BETA
        </span>
      </button>
      <FolhaBeta aberto={aberta} aoFechar={() => setAberta(false)} />
    </>
  );
}

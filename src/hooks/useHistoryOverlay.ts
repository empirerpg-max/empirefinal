import { useCallback, useEffect, useRef } from "react";
import {
  abrirCamada,
  criarMarca,
  deveFecharNoPopstate,
  deveVoltarAoFecharPelaUi,
} from "../lib/historicoOverlay";

/**
 * Camada por cima de outra tela: o "voltar" do celular/navegador fecha só
 * esta camada. Ao abrir empurra uma entrada própria no histórico; fecha no
 * popstate só quando a entrada dela saiu; ao fechar pelo X/seta consome a
 * entrada (history.back()) só se ela ainda for a atual.
 * `fechar()` é o que o X/seta deve chamar. SSR-safe: só toca `window` em efeito.
 */
export function useHistoryOverlay(aberto: boolean, aoFechar: () => void): { fechar: () => void } {
  const aoFecharRef = useRef(aoFechar);
  aoFecharRef.current = aoFechar;

  useEffect(() => {
    if (!aberto) return;
    const marca = criarMarca();
    let fechadoPeloVoltar = false;
    abrirCamada(window.history, marca);

    const onPopState = () => {
      if (!deveFecharNoPopstate(window.history.state, marca)) return;
      fechadoPeloVoltar = true;
      aoFecharRef.current();
    };
    window.addEventListener("popstate", onPopState);

    return () => {
      window.removeEventListener("popstate", onPopState);
      if (!fechadoPeloVoltar && deveVoltarAoFecharPelaUi(window.history.state, marca)) {
        window.history.back();
      }
    };
  }, [aberto]);

  const fechar = useCallback(() => aoFecharRef.current(), []);
  return { fechar };
}

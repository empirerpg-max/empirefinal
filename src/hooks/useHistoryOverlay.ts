import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import {
  abrirCamada,
  criarDesmontador,
  criarMarca,
  deveFecharNoPopstate,
} from "../lib/historicoOverlay";

// useLayoutEffect avisa no servidor; no SSR usa useEffect (que nem roda lá).
const useEfeitoIsomorfico = typeof window === "undefined" ? useEffect : useLayoutEffect;

// Coordena camadas que desmontam no mesmo commit (um único history.go(-n)).
let desmontador: ReturnType<typeof criarDesmontador> | null = null;
function obterDesmontador() {
  return (desmontador ??= criarDesmontador(window.history, (f) => queueMicrotask(f)));
}

/**
 * Camada por cima de outra tela: o "voltar" do celular/navegador fecha só
 * esta camada. Ao abrir empurra uma entrada própria no histórico; fecha no
 * popstate só quando a entrada dela saiu; ao fechar pelo X/seta consome a(s)
 * entrada(s) dela só se ainda forem as atuais.
 * `fechar()` é o que o X/seta deve chamar. SSR-safe: só toca `window` em efeito.
 *
 * Importante: a camada NÃO se fecha sozinha quando o router faz PUSH para
 * outra rota; quem a hospeda deve desmontar (ou pôr `aberto=false`) na troca
 * de rota. Nesse caso a entrada dela já saiu da pilha e não chamamos back().
 *
 * StrictMode (só dev): o efeito roda, limpa e roda de novo, empurrando e
 * consumindo uma entrada extra; em produção não acontece.
 */
export function useHistoryOverlay(aberto: boolean, aoFechar: () => void): { fechar: () => void } {
  const aoFecharRef = useRef(aoFechar);
  useEfeitoIsomorfico(() => {
    aoFecharRef.current = aoFechar;
  });

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
      obterDesmontador()(marca, fechadoPeloVoltar);
    };
  }, [aberto]);

  const fechar = useCallback(() => aoFecharRef.current(), []);
  return { fechar };
}

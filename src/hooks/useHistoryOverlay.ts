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
// Criado no primeiro open (dentro do efeito, SSR-safe), junto com o ouvinte
// global de popstate, registrado cedo (antes dos ouvintes das camadas).
let desmontador: ReturnType<typeof criarDesmontador> | null = null;
function obterDesmontador() {
  if (!desmontador) {
    const d = (desmontador = criarDesmontador(window.history, (f) => queueMicrotask(f)));
    window.addEventListener("popstate", () => d.assentou());
  }
  return desmontador;
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
 * Troca de camada (uma fecha pelo X e outra abre no mesmo commit, ex.: um
 * menu que abre uma folha): a nova REAPROVEITA a entrada da que fechou
 * (replaceState, cancelando o go() pendente), então fica exatamente uma
 * entrada por camada visível; o próximo voltar fecha a nova e cai na tela
 * de baixo. Se mais de uma camada fechava junto, o go() para uma entrada
 * antes e a nova assume essa entrada quando ele pousar.
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
    abrirCamada(window.history, marca, obterDesmontador());

    const onPopState = () => {
      if (!deveFecharNoPopstate(window.history.state, marca)) return;
      fechadoPeloVoltar = true;
      aoFecharRef.current();
    };
    window.addEventListener("popstate", onPopState);

    return () => {
      window.removeEventListener("popstate", onPopState);
      obterDesmontador().desmontar(marca, fechadoPeloVoltar);
    };
  }, [aberto]);

  const fechar = useCallback(() => aoFecharRef.current(), []);
  return { fechar };
}

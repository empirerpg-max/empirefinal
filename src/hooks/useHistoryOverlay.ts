import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import {
  abrirCamada,
  criarDesmontador,
  criarMarca,
  deveFecharNoPopstate,
  esperarSaidaDaEntrada,
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
 * `fechar(depois)`: para uma ação que MUDA DE TELA (router.navigate etc.).
 * Fecha e só roda `depois` quando a entrada desta camada já saiu do
 * histórico (popstate pousado), com tempo limite de segurança
 * (`esperarSaidaDaEntrada`). Navegar no mesmo toque deixaria a entrada da
 * camada órfã por baixo da rota nova (o go() de fechamento ainda em voo vê
 * o state da rota nova, sem marcas, e não volta nada).
 *
 * Importante: a camada NÃO se fecha sozinha quando o router faz PUSH para
 * outra rota; quem a hospeda deve desmontar (ou pôr `aberto=false`) na troca
 * de rota. Nesse caso a entrada dela continua na pilha, mas não é mais a do
 * topo (a rota nova está por cima, sem marcas), e não chamamos back() para
 * não desfazer a navegação. Por isso, ação que navega usa `fechar(depois)`.
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
export function useHistoryOverlay(
  aberto: boolean,
  aoFechar: () => void,
): { fechar: (depois?: unknown) => void } {
  const aoFecharRef = useRef(aoFechar);
  const marcaRef = useRef<string | null>(null);
  useEfeitoIsomorfico(() => {
    aoFecharRef.current = aoFechar;
  });

  useEffect(() => {
    if (!aberto) return;
    const marca = criarMarca();
    marcaRef.current = marca;
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
      if (marcaRef.current === marca) marcaRef.current = null;
      obterDesmontador().desmontar(marca, fechadoPeloVoltar);
    };
  }, [aberto]);

  const fechar = useCallback((depoisOuEvento?: unknown) => {
    // Aceita `onClick={fechar}`: o evento do clique não é um `depois`.
    const depois = typeof depoisOuEvento === "function" ? (depoisOuEvento as () => void) : undefined;
    const marca = marcaRef.current;
    if (depois) {
      if (marca === null) {
        // camada sem entrada (fechada/nem abriu): nada a esperar
        aoFecharRef.current();
        depois();
        return;
      }
      // Registra antes de fechar: o popstate do go() de fechamento chega depois.
      esperarSaidaDaEntrada({
        marca,
        depois,
        lerState: () => window.history.state,
        ouvirPopstate: (f) => {
          window.addEventListener("popstate", f);
          return () => window.removeEventListener("popstate", f);
        },
        esperar: (f, ms) => {
          const t = window.setTimeout(f, ms);
          return () => window.clearTimeout(t);
        },
        emSeguida: (f) => {
          window.setTimeout(f, 0);
        },
      });
    }
    aoFecharRef.current();
  }, []);
  return { fechar };
}

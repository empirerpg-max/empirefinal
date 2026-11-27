/**
 * Matemática da fileira rolável com setas (`ScrollRow`, spec 6.1), sem DOM —
 * testada em `scripts/beta-scrollrow.test.ts`. O componente só mede
 * `scrollLeft`/`clientWidth`/`scrollWidth` e as posições dos itens e chama
 * estas funções.
 */

/** Largura (px) da faixa de cada seta: degradê do fundo + botão redondo. */
export const FAIXA_SETA = 56;

/** Folga (px) para considerar que chegou na ponta — a mesma do `useDragScroll`. */
const MARGEM_BORDA = 4;

/** Diz de que lado ainda tem conteúdo escondido (onde a seta aparece). */
export function bordas(
  scrollLeft: number,
  clientWidth: number,
  scrollWidth: number,
): { esquerda: boolean; direita: boolean } {
  return {
    esquerda: scrollLeft > MARGEM_BORDA,
    direita: scrollLeft + clientWidth < scrollWidth - MARGEM_BORDA,
  };
}

/**
 * Para onde rolar ao tocar numa seta: avança "uma página" (largura visível −
 * as duas faixas) e encosta no começo de um item.
 *
 * `inicios` são as posições de rolagem (`scrollLeft`) em que cada item fica
 * encostado logo depois da faixa da esquerda, em ordem crescente (o
 * componente passa `offsetLeft − faixa`, limitado a 0 — é o mesmo ponto em
 * que o `scroll-snap` com `scroll-padding` = faixa encosta o item).
 *
 * - Para a frente: o maior início ≤ alvo que esteja à frente da posição atual;
 *   se nenhum couber na página (item mais largo que ela), o próximo início.
 * - Para trás: o menor início ≥ alvo que esteja atrás da posição atual; se
 *   nenhum, o início anterior.
 * - Sempre limitado a `[0, último início]`.
 */
export function destinoDaPagina(
  dir: -1 | 1,
  scrollLeft: number,
  clientWidth: number,
  inicios: number[],
  faixa = FAIXA_SETA,
): number {
  if (inicios.length === 0) return 0;
  const ultimo = inicios[inicios.length - 1];
  const limitar = (v: number) => Math.min(Math.max(v, 0), Math.max(ultimo, 0));
  const passo = Math.max(clientWidth - 2 * faixa, 0);
  // 1 px de tolerância: o navegador arredonda scrollLeft.
  const TOL = 1;

  if (dir === 1) {
    const alvo = scrollLeft + passo;
    const aFrente = inicios.filter((x) => x > scrollLeft + TOL);
    if (aFrente.length === 0) return limitar(ultimo);
    const naPagina = aFrente.filter((x) => x <= alvo);
    return limitar(naPagina.length > 0 ? naPagina[naPagina.length - 1] : aFrente[0]);
  }

  const alvo = scrollLeft - passo;
  const atras = inicios.filter((x) => x < scrollLeft - TOL);
  if (atras.length === 0) return 0;
  const naPagina = atras.filter((x) => x >= alvo);
  return limitar(naPagina.length > 0 ? naPagina[0] : atras[atras.length - 1]);
}

/**
 * Quanto rolar para que o item `[inicio, fim]` (em coordenadas do conteúdo,
 * `offsetLeft` e `offsetLeft + offsetWidth`) fique inteiro entre as duas
 * faixas. `null` se ele já está inteiro (ou se a rolagem não mudaria nada).
 * Item mais largo que a área útil: mostra o começo dele.
 */
export function scrollParaMostrar(
  inicio: number,
  fim: number,
  scrollLeft: number,
  clientWidth: number,
  faixa = FAIXA_SETA,
): number | null {
  const areaInicio = scrollLeft + faixa;
  const areaFim = scrollLeft + clientWidth - faixa;
  let destino: number;
  if (inicio < areaInicio || fim - inicio > areaFim - areaInicio) {
    destino = inicio - faixa;
  } else if (fim > areaFim) {
    destino = fim - clientWidth + faixa;
  } else {
    return null;
  }
  destino = Math.max(destino, 0);
  return Math.abs(destino - scrollLeft) < 1 ? null : destino;
}

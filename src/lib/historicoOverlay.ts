/**
 * Núcleo (sem React, sem DOM) do "voltar fecha só esta camada".
 *
 * Cada camada (folha, menu, player...) empurra uma entrada no histórico com
 * uma marca própria no `state`. Escolha de projeto: além de `__overlay` (a
 * marca da entrada atual), guardamos `__overlays` = pilha de marcas abertas
 * até ali ([...anteriores, marca]). Com duas camadas empilhadas, o popstate
 * da de baixo também dispara quando a de cima é fechada; como o state então
 * atual ainda contém a marca da de baixo, ela NÃO fecha. Só fecha quando a
 * marca dela some da pilha do state atual (a entrada dela saiu).
 * Guardar índice/length do histórico não é confiável (o router também
 * empurra entradas), por isso a pilha de marcas viaja dentro do state.
 */

export type HistoricoLike = {
  state: unknown;
  pushState(s: unknown, t: string): void;
  back(): void;
};

let contador = 0;

/** Id único por camada. */
export function criarMarca(): string {
  contador++;
  return `ov-${contador}-${Math.random().toString(36).slice(2, 8)}`;
}

function comoObjeto(state: unknown): Record<string, unknown> {
  return state && typeof state === "object" ? (state as Record<string, unknown>) : {};
}

function pilhaDe(state: unknown): string[] {
  const p = comoObjeto(state).__overlays;
  return Array.isArray(p) ? (p as string[]) : [];
}

/** Empurra a entrada da camada preservando o state atual (o TanStack Router guarda dados nele). */
export function abrirCamada(h: HistoricoLike, marca: string): void {
  const atual = comoObjeto(h.state);
  h.pushState({ ...atual, __overlay: marca, __overlays: [...pilhaDe(h.state), marca] }, "");
}

/** O state atual é exatamente a entrada desta camada (é o topo). */
export function entradaEhDaCamada(state: unknown, marca: string): boolean {
  return comoObjeto(state).__overlay === marca;
}

/** No popstate: fecha só quando a entrada da camada saiu (marca ausente da pilha do state atual). */
export function deveFecharNoPopstate(stateAtual: unknown, marca: string): boolean {
  return !pilhaDe(stateAtual).includes(marca);
}

/** Ao fechar pelo X/seta: só chama history.back() se a entrada da camada ainda é a atual. */
export function deveVoltarAoFecharPelaUi(stateAtual: unknown, marca: string): boolean {
  return entradaEhDaCamada(stateAtual, marca);
}

/**
 * Quantas entradas consumir ao desmontar a camada `marca` (sem contar as já
 * agendadas por outras camadas no mesmo tick, ver `pendentes`).
 * - fechada pelo voltar: 0 (a entrada já saiu).
 * - marca fora da pilha do state atual (navegou para outra rota, entrada já
 *   saiu): 0, para nunca desfazer navegação alheia.
 * - senão: entradas de `marca` até o topo da pilha (inclusive), pois camadas
 *   acima dela que fecham junto também deixaram entradas.
 * `history.back()` é assíncrono: duas camadas que fecham no mesmo commit leem
 * o mesmo state; por isso desconta-se `pendentes` (já agendadas neste tick).
 */
export function quantoVoltarAoDesmontar(
  stateAtual: unknown,
  marca: string,
  fechadoPeloVoltar: boolean,
  pendentes = 0,
): number {
  if (fechadoPeloVoltar) return 0;
  const pilha = pilhaDe(stateAtual);
  const i = pilha.indexOf(marca);
  if (i < 0) return 0;
  return Math.max(0, pilha.length - i - pendentes);
}

/**
 * Cria o "desmontador": coordena camadas que desmontam no mesmo tick para
 * resultar em um único `history.go(-n)`. `agendar` zera o contador quando o
 * tick acaba (no app: queueMicrotask).
 */
export function criarDesmontador(
  h: HistoricoLike & { go(delta: number): void },
  agendar: (f: () => void) => void,
) {
  let pendentes = 0;
  return function desmontar(marca: string, fechadoPeloVoltar: boolean): void {
    const n = quantoVoltarAoDesmontar(h.state, marca, fechadoPeloVoltar, pendentes);
    if (n <= 0) return;
    if (pendentes === 0) agendar(() => (pendentes = 0));
    pendentes += n;
    h.go(-n);
  };
}

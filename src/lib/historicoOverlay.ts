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
  replaceState(s: unknown, t: string): void;
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

/** State da entrada da camada: preserva o atual (o TanStack Router guarda dados nele). */
function stateDaCamada(h: HistoricoLike, abaixo: string[], marca: string): unknown {
  return { ...comoObjeto(h.state), __overlay: marca, __overlays: [...abaixo, marca] };
}

/** Quem pode ceder uma entrada que está fechando (ver `criarDesmontador`). */
export type Reaproveitador = { reaproveitar(marca: string): boolean };

/**
 * Empurra a entrada da camada preservando o state atual. Com `desmontador`:
 * se o topo do histórico é de uma camada com fechamento pendente (fechou pela
 * UI neste mesmo tick e o go() ainda não saiu), a nova camada REAPROVEITA
 * essa entrada (replaceState) em vez de empurrar outra: uma entrada por
 * camada visível, sem órfã e sem consumir a da nova.
 */
export function abrirCamada(h: HistoricoLike, marca: string, desmontador?: Reaproveitador): void {
  if (desmontador?.reaproveitar(marca)) return;
  h.pushState(stateDaCamada(h, pilhaDe(h.state), marca), "");
}

/** O state atual é exatamente a entrada desta camada (é o topo). */
export function entradaEhDaCamada(state: unknown, marca: string): boolean {
  return comoObjeto(state).__overlay === marca;
}

/** No popstate: fecha só quando a entrada da camada saiu (marca ausente da pilha do state atual). */
export function deveFecharNoPopstate(stateAtual: unknown, marca: string): boolean {
  return !pilhaDe(stateAtual).includes(marca);
}

/** Helper puro (o hook usa `quantoVoltarAoDesmontar`): só voltar se a entrada da camada ainda é a atual. */
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
 * resultar em UM único `history.go(-n)` (navegadores podem descartar/fundir
 * vários go() no mesmo tick).
 * Contabilidade em comprimentos ABSOLUTOS da pilha de marcas (estável mesmo
 * com o state ainda velho, pois go() é assíncrono): fechar a camada na posição
 * `i` da pilha leva a pilha a ter comprimento `i`. `alvo` = menor comprimento
 * pedido na janela; `emitido` = comprimento que a pilha terá quando todos os
 * go() já emitidos pousarem. Só emite a diferença (nunca conta em dobro entre
 * ticks). `assentou()` (chamar no popstate) só encerra a janela quando o state
 * pousado já tem comprimento <= `emitido`; um popstate intermediário de go()
 * ainda em voo não zera nada. `agendar` roda a emissão ao fim do tick.
 */
export function criarDesmontador(
  h: HistoricoLike & { go(delta: number): void },
  agendar: (f: () => void) => void,
) {
  let alvo: number | null = null;
  let emitido: number | null = null;
  let agendado = false;
  // Troca de camada com mais de uma entrada fechando (alvo abaixo do topo):
  // camadas que abriram na janela e esperam o go() pousar na entrada `alvo`
  // para assumi-la (a 1a por replaceState, as demais por pushState).
  let aguardando: string[] = [];
  let reservado = false; // o go() emitido deixou uma entrada para `aguardando`
  return {
    desmontar(marca: string, fechadoPeloVoltar: boolean): void {
      const k = aguardando.indexOf(marca);
      if (k >= 0) {
        aguardando.splice(k, 1); // ainda nem tinha entrada
        return;
      }
      if (fechadoPeloVoltar) return;
      const i = pilhaDe(h.state).indexOf(marca);
      if (i < 0) return;
      if (emitido !== null && i >= emitido) return; // já coberta por go() emitido
      if (alvo !== null && i >= alvo) return;
      alvo = i;
      if (agendado) return;
      agendado = true;
      agendar(() => {
        agendado = false;
        if (alvo === null) return;
        const base = emitido ?? pilhaDe(h.state).length;
        reservado = aguardando.length > 0;
        const fim = reservado ? alvo + 1 : alvo;
        const extra = base - fim;
        if (extra > 0) {
          emitido = fim;
          h.go(-extra);
        } else reservado = false;
        alvo = null;
      });
    },
    /**
     * Abrir no mesmo tick em que o topo está fechando pela UI (pendente, go()
     * ainda não emitido): a nova camada fica com a entrada que sairia.
     * Só o topo fechando: replaceState já e o go() pendente é cancelado.
     * Mais entradas fechando: o go() para uma antes e a camada assume aquela
     * entrada quando ele pousar (em `assentou`).
     */
    reaproveitar(marca: string): boolean {
      if (alvo === null || !agendado || emitido !== null) return false;
      const pilha = pilhaDe(h.state);
      const topo = pilha.length - 1;
      if (alvo > topo) return false;
      if (alvo === topo && aguardando.length === 0) {
        h.replaceState(stateDaCamada(h, pilha.slice(0, topo), marca), "");
        alvo = null;
        return true;
      }
      aguardando.push(marca);
      return true;
    },
    assentou(): void {
      if (emitido === null) return;
      const n = pilhaDe(h.state).length;
      if (reservado && n === emitido) {
        reservado = false;
        const [primeira, ...resto] = aguardando;
        aguardando = [];
        if (primeira === undefined) {
          // quem ia assumir a entrada fechou antes: consome-a também
          emitido = n - 1;
          h.go(-1);
          return;
        }
        const abaixo = pilhaDe(h.state).slice(0, n - 1);
        h.replaceState(stateDaCamada(h, abaixo, primeira), "");
        let pilhaAtual = [...abaixo, primeira];
        for (const m of resto) {
          h.pushState(stateDaCamada(h, pilhaAtual, m), "");
          pilhaAtual = [...pilhaAtual, m];
        }
        emitido = null;
        alvo = null;
        return;
      }
      if (n <= emitido) {
        // pousou (ou o usuário voltou além): encerra a janela
        reservado = false;
        aguardando = [];
        emitido = null;
        alvo = null;
      }
    },
  };
}

/**
 * Tempo máximo (ms) que uma ação "que muda de tela" espera a entrada da
 * camada sair antes de rodar assim mesmo (a ação nunca se perde).
 */
export const LIMITE_ESPERA_SAIDA_MS = 500;

/**
 * Roda `depois` uma única vez, só quando a entrada da camada `marca` já saiu
 * do histórico (a marca sumiu da pilha `__overlays` do state atual, conferida
 * no popstate), ou ao estourar `limiteMs` se nenhum popstate chegar (ex.: a
 * entrada foi reaproveitada por outra camada via replaceState, ou quem
 * hospeda não fechou). `depois` roda fora do despacho do popstate
 * (`emSeguida`), para os outros ouvintes (router, desmontador) verem o state
 * pousado antes de a ação navegar. Se a entrada já não está na pilha ao
 * começar, roda logo (em `emSeguida`).
 *
 * Por quê: navegar (pushState do router) enquanto o go() de fechamento ainda
 * está em voo deixa a entrada da camada órfã por baixo da rota nova.
 */
export function esperarSaidaDaEntrada(opcoes: {
  marca: string;
  depois: () => void;
  lerState: () => unknown;
  ouvirPopstate: (f: () => void) => () => void;
  esperar: (f: () => void, ms: number) => () => void;
  emSeguida: (f: () => void) => void;
  limiteMs?: number;
}): void {
  const { marca, depois, lerState, ouvirPopstate, esperar, emSeguida } = opcoes;
  let feito = false;
  let pararDeOuvir = () => {};
  let cancelarLimite = () => {};
  const concluir = () => {
    if (feito) return;
    feito = true;
    pararDeOuvir();
    cancelarLimite();
    emSeguida(depois);
  };
  if (!pilhaDe(lerState()).includes(marca)) {
    concluir();
    return;
  }
  pararDeOuvir = ouvirPopstate(() => {
    if (deveFecharNoPopstate(lerState(), marca)) concluir();
  });
  cancelarLimite = esperar(concluir, opcoes.limiteMs ?? LIMITE_ESPERA_SAIDA_MS);
}

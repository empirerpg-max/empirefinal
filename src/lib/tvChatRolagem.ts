// Regras puras de rolagem do chat da Empire TV.
// Sem dependências e sem acesso ao DOM: recebem números e devolvem decisões.

/**
 * Diz se o usuário está "no fim" da lista: a distância até o fundo
 * (scrollHeight - scrollTop - clientHeight) é <= folgaPx.
 * Exatamente folgaPx conta como no fim.
 */
export function estaNoFim(
  el: { scrollTop: number; scrollHeight: number; clientHeight: number },
  folgaPx = 80,
): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= folgaPx;
}

/**
 * Diz se a rolagem está perto do topo: scrollTop <= limitePx.
 * Exatamente limitePx conta como perto do topo.
 */
export function pertoDoTopo(scrollTop: number, limitePx = 120): boolean {
  return scrollTop <= limitePx;
}

/**
 * Decide o que fazer ao chegar uma mensagem nova.
 * - Se estava no fim ou a mensagem é do próprio usuário: rola e zera o contador.
 * - Senão: não rola e soma 1 às novas mensagens não lidas.
 */
export function decidirAoChegar(
  noFim: boolean,
  minha: boolean,
  novasAntes: number,
): { rolar: boolean; novas: number } {
  if (noFim || minha) return { rolar: true, novas: 0 };
  return { rolar: false, novas: novasAntes + 1 };
}

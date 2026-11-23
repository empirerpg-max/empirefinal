// Orçamento de chamadas externas (fetch/D1) por execução — pre-save em passos.
//
// Causa real dos lançamentos incompletos (Jessica Johnson, "Bad Behavior",
// 22/11): cada execução do Worker só conseguia gravar umas 3-4 faixas; as
// seguintes falhavam em segundos, sem log (o log também é uma chamada
// externa). Cada faixa faz ~10 chamadas ao Google. O motor do pre-save roda
// dentro de `comOrcamento`, cada fetch ao Google registra uma chamada (e o
// motor registra as do D1), e o motor para com folga antes de estourar —
// continuando na próxima execução do cron.
//
// Estado por EXECUÇÃO (AsyncLocalStorage), não por isolate: o cron e um
// relançamento admin rodando no mesmo isolate não se misturam (revisão I4).
// Fora de um `comOrcamento`, nada é limitado (Infinity) — o resto do app
// nunca é afetado.
import { AsyncLocalStorage } from "node:async_hooks";

interface Orcamento {
  limite: number;
  usadas: number;
}

const contexto = new AsyncLocalStorage<Orcamento>();

export function comOrcamento<T>(limite: number, fn: () => Promise<T>): Promise<T> {
  return contexto.run({ limite, usadas: 0 }, fn);
}

export function registrarChamadaExterna(n = 1): void {
  const o = contexto.getStore();
  if (o) o.usadas += n;
}

export function chamadasRestantes(): number {
  const o = contexto.getStore();
  if (!o) return Infinity;
  return Math.max(0, o.limite - o.usadas);
}

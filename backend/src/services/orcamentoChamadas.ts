// Orçamento de chamadas externas (fetch) por execução — pre-save em passos.
//
// Causa real dos lançamentos incompletos (Jessica Johnson, "Bad Behavior",
// 22/11): cada execução do Worker só conseguia gravar umas 3-4 faixas; as
// seguintes falhavam em segundos, sem log (o log também é uma chamada
// externa). Cada faixa faz ~10 chamadas ao Google. O motor do pre-save
// (presaveLancamento/motor.ts) inicia um orçamento, cada fetch ao Google
// registra uma chamada, e o motor para com folga antes de estourar —
// continuando na próxima execução do cron.
//
// Estado no nível do módulo (por isolate). Sem orçamento iniciado, nada é
// limitado (Infinity) — o resto do app nunca é afetado.
let limite: number | null = null;
let usadas = 0;

export function iniciarOrcamento(novoLimite: number): void {
  limite = novoLimite;
  usadas = 0;
}

export function registrarChamadaExterna(): void {
  if (limite !== null) usadas++;
}

export function chamadasRestantes(): number {
  if (limite === null) return Infinity;
  return Math.max(0, limite - usadas);
}

export function encerrarOrcamento(): void {
  limite = null;
  usadas = 0;
}

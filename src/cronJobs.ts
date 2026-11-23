// Despacho dos crons do Worker (wrangler.jsonc, "triggers.crons").
// O pre-save roda num cron próprio, deslocado 2 minutos dos outros jobs:
// o limite de chamadas externas vale por execução, e dividir a mesma
// execução com TV, Social, likes etc. deixava o lançamento sem fôlego
// (ver docs/superpowers/specs/2026-11-23-presave-lancamento-em-passos-design.md).
export const CRON_PRESAVE = "2-59/10 * * * *";

export function ehCronPresave(cron: string | undefined): boolean {
  return cron === CRON_PRESAVE;
}

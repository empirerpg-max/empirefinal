// Despacho dos crons do Worker (wrangler.jsonc, "triggers.crons").
// O pre-save roda num cron próprio, deslocado 2 minutos dos outros jobs:
// o limite de chamadas externas vale por execução, e dividir a mesma
// execução com TV, Social, likes etc. deixava o lançamento sem fôlego
// (ver docs/superpowers/specs/2026-11-23-presave-lancamento-em-passos-design.md).
export const CRON_PRESAVE = "2-59/10 * * * *";

export function ehCronPresave(cron: string | undefined): boolean {
  return cron === CRON_PRESAVE;
}

// Jobs pesados em linhas lidas do D1 rodam só no primeiro ciclo de cada hora
// do cron de 10 min (minutos 0–9): o plano gratuito do D1 tem limite diário
// de linhas lidas (spec 2026-11-26-d1-rows-read-reducao).
export function ehCicloDaHora(agora: Date): boolean {
  return agora.getUTCMinutes() < 10;
}

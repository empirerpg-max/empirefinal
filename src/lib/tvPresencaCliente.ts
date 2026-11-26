// Coletor de minutos de presença na Empire TV (lado do app).
// Puro: não lê relógio nem faz rede — quem usa passa o "agora" em ms.
//
// O app marca "estou assistindo" no máximo uma vez por minuto de relógio e
// manda ao servidor só as IDADES dessas marcas (agora - marca, em ms); o
// servidor converte com o próprio relógio, então o relógio errado do
// aparelho não importa. As marcas ficam pendentes até o envio ser
// confirmado — envio que falhou é reenviado no próximo lote.

const MINUTO_MS = 60_000;
/** O servidor descarta idades acima de 6 h. */
export const IDADE_MAX_MS = 6 * 3600_000;
/** O servidor aceita no máximo 400 idades por envio. */
export const LOTE_MAX = 400;

export class ColetorMinutos {
  /** minuto de relógio (floor(ms/60000)) → instante da marca em ms */
  private marcas = new Map<number, number>();
  /** minutos devolvidos no último `pendentes` (os que `confirmar` limpa) */
  private lidos: number[] = [];

  marcar(agoraMs: number): void {
    if (!Number.isFinite(agoraMs)) return;
    const minuto = Math.floor(agoraMs / MINUTO_MS);
    if (!this.marcas.has(minuto)) this.marcas.set(minuto, agoraMs);
  }

  /** Idades (ms) das marcas ainda não confirmadas, da mais velha para a mais nova. */
  pendentes(agoraMs: number): number[] {
    for (const [minuto, ts] of this.marcas) {
      if (agoraMs - ts > IDADE_MAX_MS) this.marcas.delete(minuto);
    }
    const minutos = [...this.marcas.keys()].sort((a, b) => a - b).slice(-LOTE_MAX);
    this.lidos = minutos;
    return minutos.map((m) => Math.max(0, agoraMs - (this.marcas.get(m) as number)));
  }

  /** Envio do último `pendentes` deu certo: esquece essas marcas. */
  confirmar(): void {
    for (const m of this.lidos) this.marcas.delete(m);
    this.lidos = [];
  }
}

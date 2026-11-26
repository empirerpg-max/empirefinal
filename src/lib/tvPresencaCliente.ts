// Coletor de minutos de presença na Empire TV (lado do app).
// Puro: não lê relógio nem faz rede — quem usa passa o "agora" em ms.
//
// O app marca "estou assistindo" no máximo uma vez por minuto de relógio e
// manda ao servidor só as IDADES dessas marcas (agora - marca, em ms); o
// servidor converte com o próprio relógio, então o relógio errado do
// aparelho não importa. As marcas ficam pendentes até o servidor confirmar o
// LOTE em que foram — cada envio confirma só os seus minutos, então dois
// envios ao mesmo tempo (um falhando) nunca apagam marca que não foi gravada.

const MINUTO_MS = 60_000;
/** O servidor descarta idades acima de 6 h. */
export const IDADE_MAX_MS = 6 * 3600_000;
/** O servidor aceita no máximo 400 idades por envio. */
export const LOTE_MAX = 400;

/** Um envio: as idades que vão no corpo e os minutos que ele confirma se der certo. */
export interface LoteMinutos {
  minutos: number[];
  idades: number[];
}

export class ColetorMinutos {
  /** minuto de relógio (floor(ms/60000)) → instante da marca em ms */
  private marcas = new Map<number, number>();

  /** Recria a partir de `exportar()` (ex.: sessionStorage); ignora lixo. */
  static de(instantes: unknown): ColetorMinutos {
    const c = new ColetorMinutos();
    if (Array.isArray(instantes)) {
      for (const t of instantes) if (typeof t === "number") c.marcar(t);
    }
    return c;
  }

  marcar(agoraMs: number): void {
    if (!Number.isFinite(agoraMs)) return;
    const minuto = Math.floor(agoraMs / MINUTO_MS);
    if (!this.marcas.has(minuto)) this.marcas.set(minuto, agoraMs);
  }

  /** Lote com as marcas ainda não confirmadas (mais velha primeiro). Não apaga nada. */
  pendentes(agoraMs: number): LoteMinutos {
    for (const [minuto, ts] of this.marcas) {
      if (agoraMs - ts > IDADE_MAX_MS) this.marcas.delete(minuto);
    }
    const minutos = [...this.marcas.keys()].sort((a, b) => a - b).slice(-LOTE_MAX);
    return {
      minutos,
      idades: minutos.map((m) => Math.max(0, agoraMs - (this.marcas.get(m) as number))),
    };
  }

  /** O servidor gravou este lote: esquece só os minutos dele. */
  confirmar(lote: LoteMinutos): void {
    for (const m of lote.minutos) this.marcas.delete(m);
  }

  vazio(): boolean {
    return this.marcas.size === 0;
  }

  /** Instantes (ms) das marcas pendentes, para guardar fora da memória. */
  exportar(): number[] {
    return [...this.marcas.values()].sort((a, b) => a - b);
  }
}

// ---------- Pendentes guardados, com dono ----------
// Cada coletor guardado pertence ao jogador logado quando as marcas foram
// feitas. Só é enviado com o login desse mesmo jogador — trocar de conta na
// mesma aba nunca credita os minutos de um para o outro.

export interface PendenteGuardado {
  dono: string;
  programaId: string;
  coletor: ColetorMinutos;
}

export function chavePendente(dono: string, programaId: string): string {
  return `${dono}\u0000${programaId}`;
}

/** Entradas que podem ir agora: só as do jogador logado. Sem login, nenhuma. */
export function entradasParaEnviar(
  mapa: Map<string, PendenteGuardado>,
  donoAtual: string | null | undefined,
): PendenteGuardado[] {
  if (!donoAtual) return [];
  return [...mapa.values()].filter((e) => e.dono === donoAtual);
}

/** Formato do armazenamento (JSON). */
export function gravarPendentesGuardados(
  mapa: Map<string, PendenteGuardado>,
): Record<string, { dono: string; programaId: string; instantes: number[] }> {
  const obj: Record<string, { dono: string; programaId: string; instantes: number[] }> = {};
  for (const [chave, e] of mapa) {
    if (!e.coletor.vazio()) obj[chave] = { dono: e.dono, programaId: e.programaId, instantes: e.coletor.exportar() };
  }
  return obj;
}

/** Lê o armazenamento mantendo só as entradas do jogador logado (as outras caem). */
export function lerPendentesGuardados(
  obj: unknown,
  donoAtual: string | null | undefined,
): Map<string, PendenteGuardado> {
  const mapa = new Map<string, PendenteGuardado>();
  if (!donoAtual || !obj || typeof obj !== "object" || Array.isArray(obj)) return mapa;
  for (const v of Object.values(obj as Record<string, unknown>)) {
    if (!v || typeof v !== "object") continue;
    const { dono, programaId, instantes } = v as Record<string, unknown>;
    if (dono !== donoAtual || typeof programaId !== "string" || !programaId) continue;
    const coletor = ColetorMinutos.de(instantes);
    if (!coletor.vazio()) mapa.set(chavePendente(dono, programaId), { dono, programaId, coletor });
  }
  return mapa;
}

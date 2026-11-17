// Movimento semanal de uma música no chart (status, peak, semanas).
export interface HistoricoMusica {
  tituloNorm: string;
  /** Posição na semana imediatamente anterior do mesmo chart; null se não esteve. */
  posAnterior: number | null;
  peak: number;
  semanas: number;
  semanasN1: number;
}

export interface Movimento {
  status: "↑" | "↓" | "=" | "NEW";
  posAnterior: number | null;
  peak: number;
  semanas: number;
  semanasN1: number;
}

/** `h` é o histórico ANTES da semana atual. Sem histórico ou reentrada → NEW. */
export function calcularMovimento(pos: number, h: HistoricoMusica | undefined): Movimento {
  const n1 = pos === 1 ? 1 : 0;
  if (!h) return { status: "NEW", posAnterior: null, peak: pos, semanas: 1, semanasN1: n1 };
  const peak = Math.min(h.peak, pos);
  const semanas = h.semanas + 1;
  const semanasN1 = h.semanasN1 + n1;
  if (h.posAnterior === null) return { status: "NEW", posAnterior: null, peak, semanas, semanasN1 };
  const status = pos < h.posAnterior ? "↑" : pos > h.posAnterior ? "↓" : "=";
  return { status, posAnterior: h.posAnterior, peak, semanas, semanasN1 };
}

// Cálculo puro da presença por minuto (Empire TV). Sem dependências.

const MIN_MS = 60_000;
const IDADE_MAX_MS = 6 * 3600_000; // ignora idades acima de 6 h
const BURACO_MAX_MIN = 2; // buraco de até 2 min entre presentes conta como presença

/** Ordena e remove repetidos. */
function ordenarUnicos(xs: number[]): number[] {
  return [...new Set(xs)].sort((a, b) => a - b);
}

/** Converte idades (ms atrás) em minutos Unix pelo relógio do servidor. */
export function minutosDeIdades(agoraMs: number, idadesMs: number[]): number[] {
  const out: number[] = [];
  for (const idade of idadesMs) {
    if (!Number.isFinite(idade) || idade < 0 || idade > IDADE_MAX_MS) continue;
    out.push(Math.floor((agoraMs - idade) / MIN_MS));
  }
  return ordenarUnicos(out);
}

/** União ordenada, sem repetição. */
export function unirMinutos(...listas: number[][]): number[] {
  return ordenarUnicos(listas.flat());
}

/** Texto "29000000,29000001". */
export function codificarMinutos(m: number[]): string {
  return ordenarUnicos(m).join(",");
}

/** Lê o texto de codificarMinutos; ignora lixo. */
export function lerMinutos(s: string | null): number[] {
  if (!s) return [];
  const out: number[] = [];
  for (const parte of s.split(",")) {
    const t = parte.trim();
    if (!/^\d+$/.test(t)) continue;
    out.push(Number(t));
  }
  return ordenarUnicos(out);
}

/** Presença dentro de [inicio, fim), preenchendo buracos de até 2 min. */
export function calcularPresenca(
  minutos: number[],
  inicioMs: number,
  fimMs: number,
): { minutosPresentes: number; duracaoMin: number; pct: number; entrouMs: number | null; saiuMs: number | null } {
  const duracaoMin = Math.max(1, Math.ceil((fimMs - inicioMs) / MIN_MS));
  const dentro = ordenarUnicos(minutos).filter((m) => m * MIN_MS >= inicioMs && m * MIN_MS < fimMs);
  if (dentro.length === 0) {
    return { minutosPresentes: 0, duracaoMin, pct: 0, entrouMs: null, saiuMs: null };
  }
  let presentes = dentro.length;
  for (let i = 1; i < dentro.length; i++) {
    const buraco = dentro[i] - dentro[i - 1] - 1;
    if (buraco > 0 && buraco <= BURACO_MAX_MIN) presentes += buraco;
  }
  const pct = Math.min(100, Math.round((presentes / duracaoMin) * 100));
  return {
    minutosPresentes: presentes,
    duracaoMin,
    pct,
    entrouMs: dentro[0] * MIN_MS,
    saiuMs: dentro[dentro.length - 1] * MIN_MS,
  };
}

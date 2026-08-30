// Formato LRC simples ("[mm:ss.cc]texto" por linha) — usado pra letra
// sincronizada. Sem suporte a metadados ([ar:]/[ti:]/etc) nem múltiplos
// timestamps por linha: um par tempo+texto por linha é tudo que a tela de
// sincronização produz e o player precisa.

export interface LrcLine {
  time: number; // segundos, com casas decimais
  text: string;
}

const LRC_LINE_RE = /^\[(\d{1,2}):(\d{2})(?:\.(\d{1,2}))?\](.*)$/;

export function parseLrc(raw: string | null | undefined): LrcLine[] {
  if (!raw) return [];
  const lines: LrcLine[] = [];
  for (const rawLine of raw.split("\n")) {
    const m = rawLine.match(LRC_LINE_RE);
    if (!m) continue;
    const minutes = Number(m[1]);
    const seconds = Number(m[2]);
    const centis = m[3] ? Number(m[3].padEnd(2, "0")) : 0;
    const time = minutes * 60 + seconds + centis / 100;
    lines.push({ time, text: m[4].trim() });
  }
  return lines.sort((a, b) => a.time - b.time);
}

export function formatLrc(lines: LrcLine[]): string {
  return lines
    .slice()
    .sort((a, b) => a.time - b.time)
    .map(({ time, text }) => {
      const minutes = Math.floor(time / 60);
      const seconds = Math.floor(time % 60);
      const centis = Math.round((time - Math.floor(time)) * 100);
      const mm = String(minutes).padStart(2, "0");
      const ss = String(seconds).padStart(2, "0");
      const cc = String(centis).padStart(2, "0");
      return `[${mm}:${ss}.${cc}]${text}`;
    })
    .join("\n");
}

// Índice da linha "atual" pro instante informado — a última cujo tempo já
// passou. -1 antes da primeira linha começar.
export function findCurrentLrcLineIndex(lines: LrcLine[], currentTime: number): number {
  let idx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].time <= currentTime) idx = i;
    else break;
  }
  return idx;
}

export function formatLrcTimestamp(time: number): string {
  const minutes = Math.floor(time / 60);
  const seconds = Math.floor(time % 60);
  const centis = Math.round((time - Math.floor(time)) * 100);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(centis).padStart(2, "0")}`;
}

// Parse e validação das linhas da aba DADOS (CHART, DATA, POSIÇÃO, MÚSICA/ALBUM, PONTOS, VENDAS GERAIS, _, ARTISTA 1..5).
import { CHARTS, type LinhaDados } from "./tipos";

/** "1.175" → 1175; "17.492.254" → 17492254; vazio/inválido → null. */
export function parseNumeroBR(s: string): number | null {
  const t = (s ?? "").trim().replace(/\./g, "").replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** "25/05/2020" → "2020-05-25". */
export function dataBrParaIso(s: string): string {
  const [d, m, a] = s.trim().split("/");
  return `${a}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

/** "2026-11-11" → "11/11/2026". */
export function dataIsoParaBr(s: string): string {
  const [a, m, d] = s.trim().split("-");
  return `${d}/${m}/${a}`;
}

const DATA_BR = /^\d{1,2}\/\d{1,2}\/\d{4}$/;

/** Converte uma linha crua da aba DADOS; null se faltar chart, data ou posição. */
export function parseLinhaDados(cols: string[]): LinhaDados | null {
  const chart = (cols[0] ?? "").trim();
  const data = (cols[1] ?? "").trim();
  const pos = parseNumeroBR(cols[2] ?? "");
  if (!chart || !DATA_BR.test(data) || pos === null) return null;
  return {
    chart,
    dataIso: dataBrParaIso(data),
    pos,
    titulo: (cols[3] ?? "").trim(),
    valor: parseNumeroBR(cols[4] ?? "") ?? 0,
    valorTotal: parseNumeroBR(cols[5] ?? ""),
    artistasPlanilha: cols.slice(7, 12).map((a) => (a ?? "").trim()).filter(Boolean),
  };
}

/** Uma semana válida: uma única data, os 5 charts, posições 1..N contíguas sem repetição por chart. */
export function validarSemana(linhas: LinhaDados[]): { ok: true; dataIso: string } | { ok: false; erros: string[] } {
  const erros: string[] = [];
  const datas = [...new Set(linhas.map((l) => l.dataIso))];
  if (datas.length !== 1) erros.push(`esperada uma única data, encontradas ${datas.length}: ${datas.join(", ") || "nenhuma"}`);

  const conhecidos = new Set<string>(CHARTS);
  const porChart = new Map<string, number[]>();
  for (const l of linhas) {
    if (!porChart.has(l.chart)) porChart.set(l.chart, []);
    porChart.get(l.chart)!.push(l.pos);
  }
  for (const c of porChart.keys()) if (!conhecidos.has(c)) erros.push(`chart desconhecido: ${c}`);
  for (const c of CHARTS) {
    const posicoes = porChart.get(c);
    if (!posicoes) { erros.push(`chart ausente: ${c}`); continue; }
    const ord = [...posicoes].sort((a, b) => a - b);
    if (ord.some((p, i) => p !== i + 1)) erros.push(`${c}: posições devem ser 1..${ord.length} contíguas sem repetição`);
  }
  return erros.length ? { ok: false, erros } : { ok: true, dataIso: datas[0] };
}

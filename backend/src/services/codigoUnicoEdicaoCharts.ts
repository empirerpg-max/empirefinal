// Regras puras (sem rede) do "Código único" de música em EDIÇÃO CHARTS!BD.
//
// REGRA FIXA: o app só escreve de A até Q em EDIÇÃO CHARTS. Da R em diante
// são fórmulas da planilha (Código único em BD, cálculos dos charts) —
// qualquer escrita ali (até "" vazio) quebra a fórmula.
//
// BD = ARRAYFORMULA(IF(B2:B=""; ""; "EMP" & TEXT(ROW(B2:B)-1; "000"))): o
// código depende só da linha. Caso Sparks (26-27/11/2026): a fórmula não
// calculou da linha 1065 em diante e as músicas ficaram sem código (sem
// Musicas!Z, sem D1 = não publicadas). O app usa o código que a fórmula
// dá pra linha, sem escrever em BD.

export type EstadoFormulaBD =
  | { tipo: "arrayformula-aberta"; formula: string }
  | { tipo: "arrayformula-limitada"; formula: string; ultimaLinha: number }
  | { tipo: "sem-arrayformula" };

/** Diagnóstico: recebe as células do topo de BD (renderização FORMULA, ex. BD1:BD3). */
export function analisarFormulaBD(celulasTopo: string[]): EstadoFormulaBD {
  const formula = celulasTopo.find((c) => /ARRAYFORMULA/i.test(c || ""));
  if (!formula) return { tipo: "sem-arrayformula" };
  // Primeiro intervalo da fórmula, ex. "B2:B" ou "$B$2:$B$1064".
  const m = /\$?([A-Z]+)\$?(\d+)\s*:\s*\$?([A-Z]+)\$?(\d*)/i.exec(formula);
  if (!m || !m[4]) return { tipo: "arrayformula-aberta", formula };
  return { tipo: "arrayformula-limitada", formula, ultimaLinha: Number(m[4]) };
}

/** O que a fórmula da planilha ("EMP" & TEXT(linha-1; "000")) dá pra `linha`. */
export function codigoDaFormulaParaLinha(linha: number): string {
  return `EMP${String(linha - 1).padStart(3, "0")}`;
}

/** Inverso: em que linha de EDIÇÃO CHARTS a fórmula gera esse código (null se não for "EMP<n>"). */
export function linhaDoCodigoDaFormula(codigo: string): number | null {
  const m = /^EMP(\d+)$/i.exec((codigo || "").trim());
  return m ? Number(m[1]) + 1 : null;
}

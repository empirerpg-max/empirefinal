// Regras puras (sem rede) do "Código único" de música em EDIÇÃO CHARTS!BD.
//
// BUG REAL (produção, 26-27/11/2026, singles da Sparks "Alone" e
// "Foolish"): a fórmula da planilha que preenche BD ("EMP" & linha-1) só
// cobria até a linha 1064 — as músicas gravadas nas linhas 1065+ ficaram
// com BD vazio. Sem código, a música não ganha Musicas!Z nem linha no D1,
// então não aparece publicada nem entra nos charts, e o app ainda dizia
// "publicado com sucesso". Daqui pra frente, quando a fórmula não preenche
// a linha, o app grava o código ele mesmo — mas só quando isso é seguro
// (ver analisarFormulaBD).

export type EstadoFormulaBD =
  // ARRAYFORMULA de intervalo aberto (B2:B) — devia cobrir a linha; gravar
  // um valor por cima bloquearia o "spill" e apagaria TODOS os códigos.
  | { tipo: "arrayformula-aberta"; formula: string }
  // ARRAYFORMULA com fim fixo (B2:B1064) — linhas depois do fim estão
  // fora dela, gravar valor ali é seguro.
  | { tipo: "arrayformula-limitada"; formula: string; ultimaLinha: number }
  // Sem ARRAYFORMULA no topo da coluna (valores fixos ou fórmula por linha).
  | { tipo: "sem-arrayformula" };

/** Recebe as células do topo de BD (renderização FORMULA, ex. BD1:BD3). */
export function analisarFormulaBD(celulasTopo: string[]): EstadoFormulaBD {
  const formula = celulasTopo.find((c) => /ARRAYFORMULA/i.test(c || ""));
  if (!formula) return { tipo: "sem-arrayformula" };
  // Primeiro intervalo da fórmula, ex. "B2:B" ou "$B$2:$B$1064".
  const m = /\$?([A-Z]+)\$?(\d+)\s*:\s*\$?([A-Z]+)\$?(\d*)/i.exec(formula);
  if (!m || !m[4]) return { tipo: "arrayformula-aberta", formula };
  return { tipo: "arrayformula-limitada", formula, ultimaLinha: Number(m[4]) };
}

/** Pode gravar um código fixo em BD na `linha` sem quebrar a fórmula? */
export function podeGravarCodigoNaLinha(estado: EstadoFormulaBD, linha: number): boolean {
  if (estado.tipo === "sem-arrayformula") return true;
  if (estado.tipo === "arrayformula-limitada") return linha > estado.ultimaLinha;
  return false;
}

/**
 * Código da música na `linha` de EDIÇÃO CHARTS — o mesmo padrão da fórmula
 * da planilha ("EMP" & TEXT(linha-1; "000")). Se esse código já estiver em
 * uso (nunca deveria, mas há colisão histórica), usa o maior + 1.
 */
export function codigoMusicaParaLinha(linha: number, codigosExistentes: string[]): string {
  const usados = new Set(
    codigosExistentes.map((c) => (c || "").trim().toUpperCase()).filter(Boolean),
  );
  const preferido = `EMP${String(linha - 1).padStart(3, "0")}`;
  if (!usados.has(preferido)) return preferido;
  let maior = 0;
  for (const c of usados) {
    const m = /^EMP(\d+)$/.exec(c);
    if (m) maior = Math.max(maior, Number(m[1]));
  }
  return `EMP${String(maior + 1).padStart(3, "0")}`;
}

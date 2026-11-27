import type { ComponentType } from "react";

/**
 * Uma ação do menu ⋯ (`ActionSheet`, spec 6.3). Parte pura, sem DOM —
 * testada em `scripts/beta-acoes.test.ts`.
 */
export type AcaoMenu = {
  id: string;
  rotulo: string;
  icone?: ComponentType<{ className?: string }>;
  /** Ação que apaga/sai/denuncia: aparece em vermelho e por último. */
  destrutiva?: boolean;
  aoEscolher: () => void;
};

/**
 * Mantém a ordem dada e move as destrutivas para o fim (estável nos dois
 * grupos). Não altera a lista recebida.
 */
export function ordenarAcoes(acoes: AcaoMenu[]): AcaoMenu[] {
  return [...acoes.filter((a) => !a.destrutiva), ...acoes.filter((a) => a.destrutiva)];
}

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
  /**
   * Ação que muda de tela (router.navigate etc.): `aoEscolher` só roda depois
   * que a entrada da folha saiu do histórico (senão fica entrada órfã e o
   * voltar da tela nova cai na página de antes com a folha "fechada").
   */
  navega?: boolean;
  aoEscolher: () => void;
};

/**
 * Mantém a ordem dada e move as destrutivas para o fim (estável nos dois
 * grupos). Não altera a lista recebida.
 */
export function ordenarAcoes(acoes: AcaoMenu[]): AcaoMenu[] {
  return [...acoes.filter((a) => !a.destrutiva), ...acoes.filter((a) => a.destrutiva)];
}

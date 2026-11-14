// Leitura dos ÁLBUNS a partir do D1 — fase 3 da migração (2026-11-14).
// Remonta do espelho (espelhoAbasD1.ts) as MESMAS linhas que a planilha
// devolveria e entrega pro mesmo código de sempre (linhasParaObjetos /
// objetosComRowIndex) — o app mostra exatamente o que mostrava.
//
// Chave no KV FLAGS "albuns:leitura-d1" (sem deploy): desligada, tudo lê da
// planilha como antes; qualquer falha do D1 (ou aba vazia) cai pra planilha.
import { googleSheetsService } from "./googleSheetsService";
import { linhasDaAbaD1, linhasPorBuscaD1, type AbaEspelhada } from "./espelhoAbasD1";
import { definirFlag, flagAtiva } from "./videosD1Leitura";

export const FLAG_LEITURA_ALBUNS_D1 = "albuns:leitura-d1";
export const leituraAlbunsD1Ativa = () => flagAtiva(FLAG_LEITURA_ALBUNS_D1);
export const definirLeituraAlbunsD1 = (ativa: boolean) => definirFlag(FLAG_LEITURA_ALBUNS_D1, ativa);

/** Linhas da aba (D1 com a chave ligada, senão planilha). */
export async function linhasDaAbaDeAlbum(aba: AbaEspelhada): Promise<string[][]> {
  if (await leituraAlbunsD1Ativa()) {
    try {
      const d1 = await linhasDaAbaD1(aba);
      if (d1 && d1.length > 1) return d1;
    } catch (err) {
      console.warn(`[albunsD1Leitura] D1 falhou lendo "${aba}", caindo pra planilha:`, err);
    }
  }
  return googleSheetsService.principal.readValues(aba);
}

/**
 * Só os comentários CANDIDATOS de um tópico (superconjunto do que o filtro
 * do Fórum aceita: Comentarios_Albuns não tem coluna de título, então o
 * filtro só casa pelo ID / valor curto igual — exatamente o que chaves_busca
 * indexa). null = chave desligada ou D1 indisponível -> aba inteira.
 */
export async function linhasComentariosAlbumDoTopico(idsNormalizados: string[]): Promise<string[][] | null> {
  if (!(await leituraAlbunsD1Ativa())) return null;
  try {
    return await linhasPorBuscaD1("Comentarios_Albuns", idsNormalizados);
  } catch (err) {
    console.warn("[albunsD1Leitura] busca por tópico no D1 falhou, lendo a aba inteira:", err);
    return null;
  }
}

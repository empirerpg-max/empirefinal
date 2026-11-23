// Buscas "procurar antes de gravar" do pre-save em passos. Rodam só depois
// de uma falha (passo com procurarAntes=true) — uma execução pode ter caído
// DEPOIS de gravar na planilha e ANTES de anotar no D1; sem esta busca, a
// retomada duplicaria a linha (DERBY, FOLLIA, Jessica Johnson).
//
// REGRA: toda leitura aqui é `readFresh` (API v4, sem cache e sem fallback
// GViz). O fallback GViz pula linhas vazias e desloca o índice — leitura
// que falhou LANÇA, nunca vira "não existe".
import { normalizeComparison as norm } from "../../services/googleSheetsService";
import type { DepsEscrita } from "./executores";

export async function acharAlbumPorTopico(
  deps: DepsEscrita,
  albumTopicId: string,
): Promise<{ linhaAlbuns: number; codigoUnicoAlbum: string } | null> {
  const rows = await deps.readFresh("principal", "Albuns", "A1:L20000");
  for (let i = 1; i < rows.length; i++) {
    if (norm(rows[i]?.[1]) === norm(albumTopicId)) {
      return { linhaAlbuns: i + 1, codigoUnicoAlbum: String(rows[i]?.[11] || "").trim() };
    }
  }
  return null;
}

/** Linha do álbum em EDIÇÃO CHARTS ÁLBUMS pelo nome (D) — devolve o Código único (R). */
export async function acharAlbumNaEdicaoChartsAlbuns(
  deps: DepsEscrita,
  albumFullTitle: string,
): Promise<{ linha: number; codigoUnicoAlbum: string } | null> {
  const rows = await deps.readFresh("edicaoCharts", "EDIÇÃO CHARTS ÁLBUMS", "A1:T20000");
  for (let i = 1; i < rows.length; i++) {
    if (norm(rows[i]?.[3]) === norm(albumFullTitle)) {
      return { linha: i + 1, codigoUnicoAlbum: String(rows[i]?.[17] || "").trim() };
    }
  }
  return null;
}

/** Faixa do álbum em Musicas: K == álbum, U == número da faixa, H não vazio. */
export async function acharFaixaEmMusicas(
  deps: DepsEscrita,
  albumFullTitle: string,
  num: number,
): Promise<{ linha: number; codigoUnico: string; songTitle: string } | null> {
  const rows = await deps.readFresh("principal", "Musicas", "A1:Z50000");
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] || [];
    if (
      String(r[7] || "").trim() &&
      norm(r[10]) === norm(albumFullTitle) &&
      String(r[20] || "").trim() === String(num)
    ) {
      return { linha: i + 1, codigoUnico: String(r[25] || "").trim(), songTitle: String(r[7]).trim() };
    }
  }
  return null;
}

/** Linha da faixa em EDIÇÃO CHARTS: B == título e E == álbum. Código único = BD. */
export async function acharFaixaEmEdicaoCharts(
  deps: DepsEscrita,
  songTitle: string,
  albumFullTitle: string,
): Promise<{ linha: number; codigoUnico: string } | null> {
  const rows = await deps.readFresh("edicaoCharts", "EDIÇÃO CHARTS", "A1:BD20000");
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] || [];
    if (norm(r[1]) === norm(songTitle) && norm(r[4]) === norm(albumFullTitle)) {
      return { linha: i + 1, codigoUnico: String(r[55] || "").trim() };
    }
  }
  return null;
}

export async function acharNoRegistro(
  deps: DepsEscrita,
  songTitle: string,
  albumFullTitle: string,
): Promise<boolean> {
  const rows = await deps.readFresh("registrosCharts", "REGISTRO DE MÚSICA", "A1:E20000");
  return rows.some((r) => norm(r?.[1]) === norm(songTitle) && norm(r?.[4]) === norm(albumFullTitle));
}

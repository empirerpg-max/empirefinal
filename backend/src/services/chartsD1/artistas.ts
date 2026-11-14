// Resolução de artistas, capa e gênero dos charts via catálogo (tabela musicas do D1).
import type { LinhaDados } from "./tipos";

// Normaliza título pra cruzamento robusto: remove acentos, qualquer trecho
// entre parênteses (feat., remix, edit etc. — abas de origem e Musicas às
// vezes discordam se incluem isso no título) e "feat./ft. ..." mesmo quando
// vem SEM parênteses (achado no diagnóstico: "TED - Mind Maze (feat. Rayna)"
// em "EM Alta" vs "TED - Mind Maze feat. Rayna" em Musicas — sem parênteses
// dos dois lados, ou só de um, o corte tem que valer em ambos os casos).
export function normalizarTitulo(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, "")
    .replace(/\b(feat|ft)\.?\s+.*/i, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export interface MusicaCatalogo {
  chave: string;
  artistas: string[];
  capa: string;
  genero: string;
  ehFaixaDeAlbum: boolean;
}

export interface LinhaCatalogo {
  titulo: string;
  artista: string;
  artista_2?: string | null;
  artista_3?: string | null;
  artista_4?: string | null;
  artista_5?: string | null;
  artista_6?: string | null;
  capa_url: string | null;
  genero: string | null;
  tipo_single: string | null;
}

/**
 * Indexa o catálogo por "Artista - Título" e só "Título" (normalizados).
 * Quando a mesma chave existe como single e como faixa de álbum, o single vence.
 */
export function indexarCatalogo(rows: LinhaCatalogo[]): Map<string, MusicaCatalogo> {
  const cat = new Map<string, MusicaCatalogo>();
  for (const r of rows) {
    const titulo = (r.titulo || "").trim();
    const artista = (r.artista || "").trim();
    if (!titulo) continue;
    const artistas = [r.artista, r.artista_2, r.artista_3, r.artista_4, r.artista_5, r.artista_6]
      .map((a) => (a || "").trim())
      .filter(Boolean);
    const ehFaixaDeAlbum = (r.tipo_single || "").trim().toUpperCase() === "TRACKLIST ALBUM";
    const chaves = [normalizarTitulo(`${artista} - ${titulo}`), normalizarTitulo(titulo)];
    for (const chave of chaves) {
      if (!chave) continue;
      const atual = cat.get(chave);
      if (atual && !(atual.ehFaixaDeAlbum && !ehFaixaDeAlbum)) continue;
      cat.set(chave, {
        chave,
        artistas,
        capa: (r.capa_url || "").trim(),
        genero: (r.genero || "").trim(),
        ehFaixaDeAlbum,
      });
    }
  }
  return cat;
}

/** Busca pelo título completo normalizado e, se falhar, só pela parte após " - ". */
export function buscarNoCatalogo(titulo: string, cat: Map<string, MusicaCatalogo>): MusicaCatalogo | undefined {
  const completo = cat.get(normalizarTitulo(titulo));
  if (completo) return completo;
  const partes = titulo.split(" - ");
  if (partes.length > 1) return cat.get(normalizarTitulo(partes.slice(1).join(" - ")));
  return undefined;
}

const dividirNomes = (s: string, separadores: RegExp): string[] =>
  s.split(separadores).map((n) => n.trim()).filter(Boolean);

/** Principal antes de " - " (divide por " x ", " & ", ", ") + convidados de feat./ft. (com ou sem parênteses). */
export function extrairArtistasDoTitulo(tituloDados: string): string[] {
  const idx = tituloDados.indexOf(" - ");
  if (idx < 0) return [];
  const principal = tituloDados.slice(0, idx);
  const resto = tituloDados.slice(idx + 3);
  const nomes = dividirNomes(principal, / x | & |, /i);
  const m = resto.match(/\b(?:feat|ft)\.?\s+([^)]*)/i);
  if (m) nomes.push(...dividirNomes(m[1], / x | & |, /i));
  return nomes;
}

/** Ordem: planilha (H–L) → catálogo → título filtrado pelos artistas conhecidos. */
export function resolverArtistas(
  linha: LinhaDados,
  cat: Map<string, MusicaCatalogo>,
  conhecidos: Set<string>,
): { artistas: string[]; fonte: "planilha" | "catalogo" | "titulo" | "nenhuma" } {
  if (linha.artistasPlanilha.length > 0) return { artistas: linha.artistasPlanilha, fonte: "planilha" };
  const m = buscarNoCatalogo(linha.titulo, cat);
  if (m && m.artistas.length > 0) return { artistas: m.artistas, fonte: "catalogo" };
  const vistos = new Set<string>();
  const doTitulo = extrairArtistasDoTitulo(linha.titulo).filter((n) => {
    const k = n.toUpperCase();
    if (!conhecidos.has(k) || vistos.has(k)) return false;
    vistos.add(k);
    return true;
  });
  return doTitulo.length > 0 ? { artistas: doTitulo, fonte: "titulo" } : { artistas: [], fonte: "nenhuma" };
}

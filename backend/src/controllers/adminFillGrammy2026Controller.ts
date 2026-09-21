import { readValues, appendRows, normalizeText, normalizeComparison } from "../services/googleSheetsService";

// Conserto pontual (não é rota de uso recorrente): preenche as categorias do
// Grammy Awards 2026 que o usuário mandou manualmente via print do Alan no
// WhatsApp — cada categoria vira 1 linha por indicado, reaproveitando o
// Segmento já existente na linha "molde" (vazia) daquela categoria/ano.
// Planilha "premiacoes", aba "Grammy Awards": A=Ano | B=Segmento |
// C=Categoria | D=Vencedor/Indicado | E=Título | F=Artista.
const SPREADSHEET_KEY = "premiacoes";
const SHEET = "Grammy Awards";
const ANO = "2026";

type Indicado = { artista: string; titulo: string; vencedor: boolean };

const DADOS: Record<string, Indicado[]> = {
  "BEST RECORDING PACKAGE": [
    { artista: "EVA", titulo: "HollyWouldn't", vencedor: false },
    { artista: "Paul Carter", titulo: "Evergreen", vencedor: false },
    { artista: "Rayna", titulo: "Wasteland", vencedor: false },
    { artista: "Rose Thompson", titulo: "Gentleman Prefer Blonde", vencedor: false },
    { artista: "SA5M & Moon Girls", titulo: "Coming Of Age Ceremony", vencedor: true },
    { artista: "TED", titulo: "SOLIVAGANT", vencedor: false },
  ],
  "BEST MUSIC FILM": [
    { artista: "Loreena", titulo: "Americano", vencedor: false },
    { artista: "Paul Carter", titulo: "The Evergreen World Tour - live at Coachella", vencedor: false },
    { artista: "Raven", titulo: "a Hip-Hop Night: 1997 Live Performance", vencedor: false },
    { artista: "Rose Thompson", titulo: "How to Marry a Millionaire (feat. Raven)", vencedor: true },
    { artista: "SA5M & Moon Girls", titulo: "Coming Of Age Ceremony (Inspired by Midsommar)", vencedor: false },
    { artista: "TED", titulo: "TED's Apple Music Super Bowl Halftime Show", vencedor: false },
  ],
  "BEST MUSIC VIDEO": [
    { artista: "EVA", titulo: "Holy Hollywoodia", vencedor: false },
    { artista: "Karol Morris", titulo: "GUILTY!", vencedor: false },
    { artista: "Raven", titulo: "THE FAME (with Paul Carter)", vencedor: false },
    { artista: "SA5M", titulo: "Bimbofication", vencedor: true },
    { artista: "SA5M & Moon Girls", titulo: "The Summer I Turned Rover", vencedor: false },
    { artista: "Sabine", titulo: "Saudade do Asfalto", vencedor: false },
  ],
  "BEST LATIN SONG": [
    { artista: "EVA", titulo: "Holy Hollywoodia", vencedor: false },
    { artista: "EVA & Destiny", titulo: "Plastic Western", vencedor: true },
    { artista: "Loreena", titulo: "Americano", vencedor: false },
  ],
  "BEST LATIN PERFORMANCE": [
    { artista: "EVA", titulo: "Holy Hollywoodia", vencedor: false },
    { artista: "EVA & Destiny", titulo: "Plastic Western", vencedor: false },
    { artista: "Loreena", titulo: "Americano", vencedor: false },
    { artista: "Skorpion", titulo: "TAL DO SKORPION", vencedor: true },
  ],
  "BEST RAP ALBUM": [
    { artista: "Anníbal Páris", titulo: "PATROL", vencedor: false },
    { artista: "Sabine", titulo: "Bloomwreck", vencedor: true },
  ],
  "BEST RAP SONG": [
    { artista: "Anníbal Páris", titulo: "Double Tap (feat. Karol Morris)", vencedor: false },
    { artista: "Sabine", titulo: "Saudade do Asfalto", vencedor: true },
    { artista: "Sabine", titulo: "Never Enough", vencedor: false },
  ],
  "BEST RAP/SUNG PERFORMANCE": [
    { artista: "Angela", titulo: "Watch Me", vencedor: false },
    { artista: "Anníbal Páris", titulo: "narcisistic (feat. KRØN)", vencedor: false },
    { artista: "Raven", titulo: "level up!!! RMX (feat. The Rich White Lady)", vencedor: false },
    { artista: "Sabine", titulo: "Block Party Dreams", vencedor: false },
    { artista: "Sabine", titulo: "Saudade do Asfalto", vencedor: true },
  ],
  "BEST RAP PERFORMANCE": [
    { artista: "Anníbal Páris", titulo: "narcisistic (feat. KRØN)", vencedor: false },
    { artista: "Sabine", titulo: "Never Enough", vencedor: false },
    { artista: "Sabine", titulo: "Saudade do Asfalto", vencedor: true },
  ],
  "BEST R&B SONG": [
    { artista: "Raven", titulo: "Hip-Hop Night", vencedor: false },
    { artista: "Sabine", titulo: "Diamond (Feat. Marco)", vencedor: true },
  ],
  "BEST R&B PERFORMANCE": [
    { artista: "Raven", titulo: "Hip-Hop Night", vencedor: false },
    { artista: "Sabine", titulo: "Diamond (Feat. Marco)", vencedor: true },
  ],
  "BEST ROCK/ALTERNATIVE ALBUM": [
    { artista: "Paul Carter", titulo: "Evergreen", vencedor: true },
    { artista: "Rayna", titulo: "Wasteland", vencedor: false },
  ],
  "BEST ROCK/ALTERNATIVE SONG": [
    { artista: "Dagny", titulo: "KARMA", vencedor: false },
    { artista: "Paul Carter", titulo: "director's cut", vencedor: false },
    { artista: "Rayna", titulo: "Lady in Tears", vencedor: false },
    { artista: "Zoe Lane", titulo: "SLIPKNOT", vencedor: true },
  ],
  "BEST ROCK/ALTERNATIVE PERFORMANCE": [
    { artista: "Dagny", titulo: "KARMA", vencedor: false },
    { artista: "Paul Carter", titulo: "rainforest (feat. Marco)", vencedor: true },
    { artista: "Rayna", titulo: "Lady in Tears", vencedor: false },
    { artista: "Zoe Lane", titulo: "SLIPKNOT", vencedor: false },
  ],
  "BEST ELECTRONIC/DANCE ALBUM": [{ artista: "Angela", titulo: "ANGELA", vencedor: true }],
};

// Fallback de Segmento pra categoria que não existe em NENHUM ano ainda
// (nem 2026, nem anterior) — categoria nova de verdade, sem nenhuma linha
// pra copiar o Segmento. Mapeado pelo agrupamento real do Grammy.
const SEGMENTO_FALLBACK: Record<string, string> = {
  "BEST RECORDING PACKAGE": "Packaging/Notes",
  "BEST MUSIC FILM": "Music Video/Film",
  "BEST MUSIC VIDEO": "Music Video/Film",
  "BEST LATIN SONG": "Latin",
  "BEST LATIN PERFORMANCE": "Latin",
  "BEST RAP ALBUM": "Rap",
  "BEST RAP SONG": "Rap",
  "BEST RAP/SUNG PERFORMANCE": "Rap",
  "BEST RAP PERFORMANCE": "Rap",
  "BEST R&B SONG": "R&B",
  "BEST R&B PERFORMANCE": "R&B",
  "BEST ROCK/ALTERNATIVE ALBUM": "Rock",
  "BEST ROCK/ALTERNATIVE SONG": "Rock",
  "BEST ROCK/ALTERNATIVE PERFORMANCE": "Rock",
  "BEST ELECTRONIC/DANCE ALBUM": "Dance/Electronic",
};

// Chave de dedupe: Categoria+Título+Artista (mesmo ano, 2026 fixo aqui) —
// usada pra tornar o endpoint seguro de rodar mais de uma vez (a 1ª
// tentativa parou no meio, no meio de "BEST MUSIC VIDEO", por causa da
// enxurrada de chamadas sequenciais à API do Sheets; rodar de novo sem
// dedupe duplicaria as linhas que já tinham entrado).
function chaveNomeado(categoria: string, titulo: string, artista: string): string {
  return `${normalizeComparison(categoria)}|${normalizeComparison(titulo)}|${normalizeComparison(artista)}`;
}

export async function adminFillGrammy2026Controller(): Promise<Response> {
  const rows = await readValues(SPREADSHEET_KEY, SHEET, "A:F");

  const segmentoPorCategoria = new Map<string, string>();
  const jaExiste = new Set<string>();
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const categoria = normalizeText(row[2]);
    if (!categoria) continue;
    const normCategoria = normalizeComparison(categoria);
    if (!segmentoPorCategoria.has(normCategoria)) {
      segmentoPorCategoria.set(normCategoria, normalizeText(row[1]));
    }
    if (normalizeText(row[0]) === ANO) {
      jaExiste.add(chaveNomeado(categoria, normalizeText(row[4]), normalizeText(row[5])));
    }
  }

  const novasLinhas: string[][] = [];
  const resultados: any[] = [];

  for (const [categoriaAlvo, indicados] of Object.entries(DADOS)) {
    const segmento =
      segmentoPorCategoria.get(normalizeComparison(categoriaAlvo)) ||
      SEGMENTO_FALLBACK[categoriaAlvo] ||
      "Geral";

    let escritos = 0;
    let jaTinha = 0;
    for (const nom of indicados) {
      if (jaExiste.has(chaveNomeado(categoriaAlvo, nom.titulo, nom.artista))) {
        jaTinha++;
        continue;
      }
      const status = nom.vencedor ? "Vencedor" : "Indicado";
      novasLinhas.push([ANO, segmento, categoriaAlvo, status, nom.titulo, nom.artista]);
      escritos++;
    }
    resultados.push({ categoria: categoriaAlvo, escritos, jaTinha });
  }

  // Uma chamada só à API pra todas as linhas novas de uma vez — a versão
  // anterior fazia 1 chamada por indicado (dezenas seguidas) e morria no
  // meio do caminho.
  if (novasLinhas.length > 0) {
    await appendRows(SPREADSHEET_KEY, SHEET, novasLinhas, "A:F");
  }

  return new Response(JSON.stringify({ success: true, totalNovasLinhas: novasLinhas.length, resultados }), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

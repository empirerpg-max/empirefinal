import { readValues, updateValues, appendRow, normalizeText, normalizeComparison } from "../services/googleSheetsService";

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

export async function adminFillGrammy2026Controller(): Promise<Response> {
  const rows = await readValues(SPREADSHEET_KEY, SHEET, "A:F");
  const resultados: any[] = [];

  for (const [categoriaAlvo, indicados] of Object.entries(DADOS)) {
    const normAlvo = normalizeComparison(categoriaAlvo);
    let segmento = "";
    let templateRowIndex = -1; // 0-based no array `rows`

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (normalizeText(row[0]) !== ANO) continue;
      if (normalizeComparison(row[2]) !== normAlvo) continue;
      segmento = normalizeText(row[1]);
      const jaPreenchida = !!(normalizeText(row[4]) || normalizeText(row[5]));
      if (!jaPreenchida) {
        templateRowIndex = i;
        break;
      }
    }

    if (!segmento) {
      resultados.push({ categoria: categoriaAlvo, ok: false, motivo: "Categoria não encontrada na aba pro ano 2026." });
      continue;
    }

    let escritos = 0;
    for (const nom of indicados) {
      const status = nom.vencedor ? "Vencedor" : "Indicado";
      if (templateRowIndex >= 0) {
        const rowNumber = templateRowIndex + 1;
        await updateValues(SPREADSHEET_KEY, SHEET, `D${rowNumber}:F${rowNumber}`, [[status, nom.titulo, nom.artista]]);
        templateRowIndex = -1;
      } else {
        await appendRow(SPREADSHEET_KEY, SHEET, [ANO, segmento, categoriaAlvo, status, nom.titulo, nom.artista], "A:F");
      }
      escritos++;
    }
    resultados.push({ categoria: categoriaAlvo, ok: true, escritos });
  }

  return new Response(JSON.stringify({ success: true, resultados }), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

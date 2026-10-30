import { googleSheetsService, normalizeComparison, normalizeText } from "../services/googleSheetsService";

// Grava os feats informados pelo usuário pras faixas do álbum DERBY
// (Cowboy Fresh) que já estão vinculadas na aba "Musicas", mas sem
// participante gravado: "Pero Tú" feat. Marco, "Amor-Trafico" feat.
// Loreena. Escreve na coluna O (ARTISTA 2, índice 14) só se ela estiver
// vazia — nunca sobrescreve um feat já preenchido.
//
// GET /api/empire-play/admin/fix-feats-derby?confirmar=1
export async function adminFixFeatsDerbyController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const confirmar = url.searchParams.get("confirmar") === "1";

  const FEATS: { tituloContem: string; feat: string }[] = [
    { tituloContem: "pero tu", feat: "Marco" },
    { tituloContem: "amor-trafico", feat: "Loreena" },
  ];

  const rows = await googleSheetsService.principal.readValues("Musicas", "A1:AE50000").catch(() => []);
  const resultado: { linha: number; titulo: string; featGravado: string; artista2Atual: string }[] = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    const album = normalizeComparison(row[10]); // K
    if (!album.includes("cowboy fresh") || !album.includes("derby")) continue;
    const tituloNorm = normalizeComparison(normalizeText(row[7])); // H
    const match = FEATS.find((f) => tituloNorm.includes(f.tituloContem));
    if (!match) continue;
    const artista2Atual = normalizeText(row[14]); // O
    resultado.push({ linha: i + 1, titulo: normalizeText(row[7]), featGravado: match.feat, artista2Atual });
  }

  if (!confirmar) {
    return new Response(JSON.stringify({ success: true, confirmar, resultado }, null, 2), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  for (const item of resultado) {
    if (item.artista2Atual) continue; // já tem feat gravado, não sobrescreve
    await googleSheetsService.principal.updateValues("Musicas", `O${item.linha}:O${item.linha}`, [[item.featGravado]]);
  }

  return new Response(JSON.stringify({ success: true, confirmar, resultado }, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

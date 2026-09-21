import { sheetsService } from "../services/sheetsService";
import { normalizeComparison } from "../services/googleSheetsService";

// Conserto único (não é rota de uso recorrente) da linha do álbum "In Honor
// of Music and Life Itself" (Rayna), que ficou com a coluna G ("Nome") sem
// o prefixo do artista — bug de gravação já corrigido em editController.ts
// (updateReleaseController), mas essa linha específica já tinha sido
// gravada errada antes da correção. Identifica pelo ID do tópico exato
// (estável, não muda), nunca só pelo título, pra nunca arriscar escrever
// na linha errada.
const ID_TOPICO_ALVO = "album_1789842503013_dypfym";
const TITULO_CORRIGIDO = "Rayna - In Honor of Music and Life Itself";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

/**
 * GET /api/empire-play/admin/fix-album-artist
 */
export async function adminFixAlbumArtistController(): Promise<Response> {
  const rows = await sheetsService.readValues("Albuns");
  for (let i = 1; i < rows.length; i++) {
    const idTopico = (rows[i][1] || "").trim();
    if (normalizeComparison(idTopico) !== normalizeComparison(ID_TOPICO_ALVO)) continue;

    const tituloAtual = (rows[i][6] || "").trim();
    if (normalizeComparison(tituloAtual) === normalizeComparison(TITULO_CORRIGIDO)) {
      return jsonResponse({ success: true, ok: false, motivo: "Já estava corrigido." });
    }

    await sheetsService.updateValues("Albuns", `G${i + 1}`, [[TITULO_CORRIGIDO]]);
    return jsonResponse({ success: true, ok: true, linha: i + 1, tituloAntigo: tituloAtual, tituloNovo: TITULO_CORRIGIDO });
  }

  return jsonResponse({ success: true, ok: false, motivo: "Linha não encontrada (ID do tópico não bateu)." });
}

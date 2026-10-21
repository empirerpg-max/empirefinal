import { sheetsService } from "../services/sheetsService";
import { normalizeComparison } from "../services/googleSheetsService";

// Conserto único (não é rota de uso recorrente): a linha do álbum
// "Max Gorghan - FOLLIA" ficou com a coluna G ("Novo Nome") gravada como
// "fol - Max Gorghan - FOLLIA" — sobrou um prefixo "fol - " indevido. O
// Fórum extrai artista/título fazendo split no primeiro " - " (ver
// getEmpirePlayAlbunsController), então lia artista="fol" e título
// completo "Max Gorghan - FOLLIA" sem conseguir separar o segundo traço —
// card mostrando subtítulo "fol" em vez de "Max Gorghan".
//
// Identifica pela linha/ID do tópico exato (estável), nunca só pelo
// título, pra nunca arriscar escrever na linha errada.
// GET /api/empire-play/admin/fix-follia-album-titulo
export async function adminFixFolliaAlbumTituloController(): Promise<Response> {
  const ID_TOPICO_ALVO = "album_1792551638543_utb9mi";
  const TITULO_CORRIGIDO = "Max Gorghan - FOLLIA";

  const rows = await sheetsService.readValues("Albuns").catch(() => []);
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    const idTopico = (row[1] || "").trim();
    if (normalizeComparison(idTopico) !== normalizeComparison(ID_TOPICO_ALVO)) continue;

    const tituloAtual = (row[6] || "").trim();
    if (normalizeComparison(tituloAtual) === normalizeComparison(TITULO_CORRIGIDO)) {
      return new Response(JSON.stringify({ success: true, ok: false, motivo: "Já estava corrigido." }), {
        status: 200,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }

    await sheetsService.updateValues("Albuns", `G${i + 1}`, [[TITULO_CORRIGIDO]]);
    return new Response(
      JSON.stringify({ success: true, ok: true, linha: i + 1, tituloAntigo: tituloAtual, tituloNovo: TITULO_CORRIGIDO }),
      { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  }

  return new Response(
    JSON.stringify({ success: true, ok: false, motivo: "Linha não encontrada (ID do tópico não bateu)." }),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
}

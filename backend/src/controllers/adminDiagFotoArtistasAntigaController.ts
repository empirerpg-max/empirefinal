import { googleSheetsService, normalizeComparison, normalizeText } from "../services/googleSheetsService";

// Checa, pros 11 artistas recém-criados em INFOS ACTS (que estavam sem
// linha até o backfill de hoje), se eles já tinham alguma foto cadastrada
// na aba ARTISTAS (coluna "foto") antes disso — pra não afirmar errado que
// "nunca tiveram foto nenhuma" quando pode haver uma foto antiga noutro
// lugar que o app ainda não está mostrando.
//
// GET /api/empire-play/admin/diagnostico-foto-artistas-antiga
export async function adminDiagFotoArtistasAntigaController(): Promise<Response> {
  const nomes = [
    "OVERDRIVE",
    "Perpétua Puerto",
    "John Groff",
    "808",
    "Cowboy Fresh",
    "Max Gorghan",
    "Sebastian",
    "Peter Johnson",
    "Brida",
    "ASTRoLUnAR",
    "Hayley Wonderwall",
  ];

  const rows = await googleSheetsService.usuarios.readValues("ARTISTAS");
  const header = rows[0] || [];
  const idxFoto = header.findIndex((h) => normalizeComparison(h) === normalizeComparison("foto"));

  const resultado = nomes.map((nome) => {
    const row = rows.slice(1).find((r) => normalizeComparison(r[0]) === normalizeComparison(nome));
    return {
      nome,
      existeEmArtistas: !!row,
      fotoEmArtistas: row && idxFoto >= 0 ? normalizeText(row[idxFoto]) : "",
    };
  });

  return new Response(
    JSON.stringify({ success: true, colunaFotoIndex: idxFoto, resultado }, null, 2),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
}

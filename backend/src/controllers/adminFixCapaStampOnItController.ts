import { googleSheetsService, normalizeComparison } from "../services/googleSheetsService";

// Conserto pontual: a aba Top_50_Spotify (chart do Início) tem coluna de
// capa PRÓPRIA, independente da planilha Musicas — confirmado ao vivo via
// diagnostico-chart-sheet-row que a linha "Angela - Stamp On It (feat.
// Anne Gray)" (posição 6) tinha o MESMO arquivo exato da capa da Hayley
// Wonderwall (17-WbaTlt8B6YzFSK-3aOngmjkTyOu6AT) colado ali por engano —
// nada a ver com D1/Musicas, que já estavam certos. Só corrige essa célula
// com a capa real da Angela (confirmada em Musicas!D e no D1, código
// EMP943): 1meIo6gtLHnY6v1taIczJGAJhjvbfUSAL.
//
// GET /api/empire-play/admin/fix-capa-stamp-on-it
const CAPA_CORRETA = "https://drive.google.com/file/d/1meIo6gtLHnY6v1taIczJGAJhjvbfUSAL/view?usp=drivesdk";

export async function adminFixCapaStampOnItController(): Promise<Response> {
  const rows = await googleSheetsService.principal.readValues("Top_50_Spotify");
  const header = rows[0] || [];
  const colNome = header.findIndex((h) => normalizeComparison(h) === normalizeComparison("Nome da Música"));
  const colCapa = header.findIndex((h) => normalizeComparison(h) === normalizeComparison("Capa da Música"));
  if (colNome === -1 || colCapa === -1) {
    return new Response(
      JSON.stringify({ success: false, error: "Colunas não encontradas.", header }),
      { status: 500, headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  }

  const alvo = normalizeComparison("Angela - Stamp On It (feat. Anne Gray)");
  let linha = -1;
  for (let i = 1; i < rows.length; i++) {
    if (normalizeComparison(rows[i]?.[colNome] || "") === alvo) {
      linha = i + 1;
      break;
    }
  }
  if (linha === -1) {
    return new Response(JSON.stringify({ success: false, error: "Linha não encontrada." }), {
      status: 404,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  const colLetra = String.fromCharCode(65 + colCapa);
  await googleSheetsService.principal.updateValues("Top_50_Spotify", `${colLetra}${linha}`, [[CAPA_CORRETA]]);

  return new Response(JSON.stringify({ success: true, data: { linha, capaCorrigida: CAPA_CORRETA } }), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

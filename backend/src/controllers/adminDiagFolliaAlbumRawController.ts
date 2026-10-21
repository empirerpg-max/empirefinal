import { googleSheetsService, normalizeText } from "../services/googleSheetsService";

// O diagnóstico anterior (adminDiagFolliaController) usa match EXATO
// contra "Max Gorghan - Follia" e voltou ZERO linhas — mas o álbum
// aparece no Fórum com subtítulo quebrado ("fol" em vez de "Max
// Gorghan"). Dump BRUTO (sem normalizeComparison, sem filtro de match
// exato) de qualquer linha de "Albuns" cujo texto bruto contenha "follia"
// ou "gorghan" (case-insensitive, substring), mostrando TODAS as colunas
// A-L crua, pra achar a linha real e ver exatamente o que está gravado
// nela (título truncado? coluna fora de posição? etc).
//
// GET /api/empire-play/admin/diagnostico-follia-album-raw
export async function adminDiagFolliaAlbumRawController(): Promise<Response> {
  const rows = await googleSheetsService.principal.readValues("Albuns", "A1:Z20000").catch(() => []);
  const achadas: Record<string, unknown>[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    const linhaTexto = row.map((c) => normalizeText(c)).join(" | ");
    if (!/follia|gorghan/i.test(linhaTexto)) continue;
    achadas.push({
      linha: i + 1,
      A_data: normalizeText(row[0]),
      B_idTopico: normalizeText(row[1]),
      C_capa: normalizeText(row[2]),
      D_comentariosPara: normalizeText(row[3]),
      E_idCriador: normalizeText(row[4]),
      F_nomeCriador: normalizeText(row[5]),
      G_novoNome: normalizeText(row[6]),
      H_metacriticJogador: normalizeText(row[7]),
      I_metacriticMedia: normalizeText(row[8]),
      J_encarte: normalizeText(row[9]),
      K_tipo: normalizeText(row[10]),
      L_codigoUnico: normalizeText(row[11]),
    });
  }

  return new Response(
    JSON.stringify({ success: true, total: achadas.length, achadas }, null, 2),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
}

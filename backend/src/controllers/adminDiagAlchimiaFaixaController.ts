import { googleSheetsService, normalizeText } from "../services/googleSheetsService";

// Feedback do Wesley (dono do artista Max Gorghan): tentou vincular o MV
// da faixa "Alchimia" (álbum FOLLIA) e ela não aparece na busca de pontos
// — o card mostrou "Alchimi - Alchimia" com artista "Alchimi" em vez de
// "Max Gorghan". Dump bruto (todas as colunas relevantes) das linhas de
// "Musicas" cujo título contém "Alchimia" ou "Niente senza fine", pra
// achar exatamente o que está gravado na coluna de Artista (N) e Nome (H).
//
// GET /api/empire-play/admin/diagnostico-alchimia-faixa
export async function adminDiagAlchimiaFaixaController(): Promise<Response> {
  const rows = await googleSheetsService.principal.readValues("Musicas", "A1:AE2000").catch(() => []);
  const achadas: Record<string, unknown>[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    const titulo = normalizeText(row[7]);
    if (!/alchimia|niente senza fine/i.test(titulo)) continue;
    achadas.push({
      linha: i + 1,
      B_idTopico: normalizeText(row[1]),
      C_mediaUrl: normalizeText(row[2]),
      F_comentariosPara: normalizeText(row[5]),
      H_titulo: titulo,
      K_album: normalizeText(row[10]),
      N_artPrincipal: normalizeText(row[13]),
      O_artista2: normalizeText(row[14]),
      X_pendente: normalizeText(row[23]),
      Z_codigoUnico: normalizeText(row[25]),
    });
  }

  return new Response(JSON.stringify({ success: true, total: achadas.length, achadas }, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

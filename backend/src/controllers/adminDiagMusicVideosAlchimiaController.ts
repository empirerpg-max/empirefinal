import { googleSheetsService, normalizeText } from "../services/googleSheetsService";

// Usuário reportou: adminVincularMvAlchimiaController criou uma linha NOVA
// em "Music Videos" pra faixa Alchimia (Max Gorghan), mas já existia uma
// linha de verdade pra esse vídeo. Dump de TODAS as linhas de
// "Music Videos" cujo texto bruto contenha "alchimia" ou o Código único
// EMP948 (coluna U), pra achar a linha original e a duplicata criada
// agora, antes de decidir o que corrigir.
//
// GET /api/empire-play/admin/diagnostico-music-videos-alchimia
export async function adminDiagMusicVideosAlchimiaController(): Promise<Response> {
  const rows = await googleSheetsService.principal.readValues("Music Videos", "A1:U5000").catch(() => []);
  const achadas: Record<string, unknown>[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    const linhaTexto = row.map((c) => normalizeText(c)).join(" | ");
    if (!/alchimia/i.test(linhaTexto) && normalizeText(row[20]) !== "EMP948") continue;
    achadas.push({
      linha: i + 1,
      A_idUsuario: normalizeText(row[0]),
      B_titulo: normalizeText(row[1]),
      F_messageThreadId: normalizeText(row[5]),
      H_tipoVideo: normalizeText(row[7]),
      J_dataEnvio: normalizeText(row[9]),
      M_linkVideo: normalizeText(row[12]),
      P_nomeOriginalCharts: normalizeText(row[15]),
      T_thumb: normalizeText(row[19]),
      U_codigoUnico: normalizeText(row[20]),
    });
  }

  return new Response(JSON.stringify({ success: true, total: achadas.length, achadas }, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

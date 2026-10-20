import { googleSheetsService, normalizeText, normalizeComparison } from "../services/googleSheetsService";
import { gravarLinhaRegistro } from "./registroLogController";

// Correção retroativa: o comentário do Chris em "nostalgic traveller"
// (TED, EMP945) nunca gerou entrada em REGISTRO — foi postado quando a
// linha de Musicas ainda estava vazia/fantasma (foundRowIndex sempre -1
// na busca em Sheets), e isso pulava o passo 3 inteiro (REGISTRO,
// prestígio) por inteiro, mesmo bug já corrigido agora pra comentários
// futuros (fallback D1). Confirmado via
// /admin/diagnostico-registro?jogador=Chris: 6 entradas, nenhuma pra
// "nostalgic traveller".
//
// GET /api/empire-play/admin/fix-registro-chris-nostalgic-traveller?dryRun=1
const TOPIC_ID = "musica_1792252409065_63282h";
const TOPIC_ID_PREFIXADO = "musicas_musica_1792252409065_63282h";

export async function adminFixRegistroChrisController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const dryRun = url.searchParams.get("dryRun") === "1";

  const rows = await googleSheetsService.principal.readValues("Comentarios_Musicas").catch(() => []);
  const achados: { linha: number; jogador: string }[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    const topicIdRow = normalizeText(row[0]);
    const jogador = normalizeText(row[2]);
    if (
      (topicIdRow === TOPIC_ID || topicIdRow === TOPIC_ID_PREFIXADO) &&
      normalizeComparison(jogador) === "chris"
    ) {
      achados.push({ linha: i + 1, jogador });
    }
  }

  if (achados.length !== 1) {
    return new Response(
      JSON.stringify({
        success: false,
        error: `Esperava exatamente 1 comentário do Chris nesse tópico, achou ${achados.length} — abortado.`,
        achados,
      }),
      { status: 409, headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  }

  const jogadorReal = achados[0].jogador;

  if (dryRun) {
    return new Response(
      JSON.stringify({ success: true, dryRun: true, achados, jaExistia: false }, null, 2),
      { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  }

  const ok = await gravarLinhaRegistro([
    jogadorReal,
    "TED - nostalgic traveller",
    "COMENTÁRIOS (SINGLES, VÍDEOS, MÚSICAS)",
  ]);

  return new Response(JSON.stringify({ success: ok, gravado: ok, achados }, null, 2), {
    status: ok ? 200 : 500,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

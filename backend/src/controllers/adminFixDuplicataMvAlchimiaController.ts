import { googleSheetsService, normalizeComparison } from "../services/googleSheetsService";
import { getCatalogoDb } from "../services/musicasDbService";

// Correção do erro cometido em adminVincularMvAlchimiaController: já
// existia uma linha (264) em "Music Videos" pro MV da faixa Alchimia
// (enviado via Drive, "message_thread_id" video_1792668710470_e8nwqc),
// só faltava o Código único (coluna U) — nunca preenchido porque, na
// hora que esse vídeo foi cadastrado, o título em EDIÇÃO CHARTS ainda
// estava corrompido ("Alchimi - Alchimia", já corrigido). Em vez de
// achar e completar essa linha, criei uma SEGUNDA (265, com link do
// YouTube) — duplicata real, reportada pelo usuário.
//
// Esse endpoint: (1) preenche U264 com EMP948 (a linha original, de
// verdade); (2) limpa TODAS as colunas da linha 265 (NUNCA apaga a
// linha — regra permanente de Sheets deste projeto); (3) remove o
// registro fantasma que a criação da 265 gerou no D1 (tabela midia,
// id = topicId da 265), pra não duplicar o card no Fórum.
//
// GET /api/empire-play/admin/fix-duplicata-mv-alchimia
export async function adminFixDuplicataMvAlchimiaController(): Promise<Response> {
  const LINHA_ORIGINAL = 264;
  const LINHA_DUPLICATA = 265;
  const CODIGO_UNICO = "EMP948";
  const TOPIC_ID_DUPLICATA = "video_1792675385825_bl0ecf";

  const rows = await googleSheetsService.principal
    .readValues("Music Videos", "A260:U270")
    .catch(() => []);
  const rowOriginal = rows[LINHA_ORIGINAL - 260];
  const rowDuplicata = rows[LINHA_DUPLICATA - 260];

  if (normalizeComparison(rowOriginal?.[1] || "") !== normalizeComparison("Max Gorghan - Alchimia")) {
    return new Response(
      JSON.stringify({ success: false, error: `Linha ${LINHA_ORIGINAL} não é mais a esperada — abortando.` }),
      { status: 409, headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  }
  if (normalizeComparison(rowDuplicata?.[5] || "") !== normalizeComparison(TOPIC_ID_DUPLICATA)) {
    return new Response(
      JSON.stringify({ success: false, error: `Linha ${LINHA_DUPLICATA} não é mais a duplicata esperada — abortando.` }),
      { status: 409, headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  }

  const codigoAtualOriginal = (rowOriginal?.[20] || "").trim();
  if (!codigoAtualOriginal) {
    await googleSheetsService.principal.updateValues("Music Videos", `U${LINHA_ORIGINAL}`, [[CODIGO_UNICO]]);
  }

  const linhaVazia = Array.from({ length: 21 }, () => "");
  await googleSheetsService.principal.updateValues(
    "Music Videos",
    `A${LINHA_DUPLICATA}:U${LINHA_DUPLICATA}`,
    [linhaVazia],
  );

  let midiaFantasmaRemovida = false;
  const db = getCatalogoDb();
  if (db) {
    const r = await db.prepare("DELETE FROM midia WHERE id = ?").bind(TOPIC_ID_DUPLICATA).run().catch(() => null);
    midiaFantasmaRemovida = !!r;
  }

  return new Response(
    JSON.stringify(
      {
        success: true,
        linhaOriginalCorrigida: LINHA_ORIGINAL,
        codigoUnicoJaTinha: !!codigoAtualOriginal,
        linhaDuplicataLimpa: LINHA_DUPLICATA,
        midiaFantasmaRemovida,
      },
      null,
      2,
    ),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
}

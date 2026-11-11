import { googleSheetsService } from "../services/googleSheetsService";

// Diagnóstico pontual (2026-11-11): /api/editar?artist=Samantha+Cooper&tipo=albuns
// só retorna 1 álbum (Chronicles, linha 77), mas ela tem pelo menos mais 2
// (eve/lilith linha 84, WELL IT'S OVER linha 105) — dump bruto das colunas
// A-K dessas 3 linhas (e de umas vizinhas) pra comparar exatamente o que
// está em cada célula com o que o matching de getReleasesForEditController
// espera.
//
// GET /api/gestao/admin/dump-linhas-albuns?linhas=77,84,105
export async function adminDumpLinhasAlbunsController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const linhasParam = url.searchParams.get("linhas") || "";
  const linhas = linhasParam
    .split(",")
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n) && n > 0);

  if (linhas.length === 0) {
    return new Response(JSON.stringify({ success: false, error: "Parâmetro 'linhas' é obrigatório (ex: ?linhas=77,84,105)." }), {
      status: 400,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  const allRows = await googleSheetsService.principal.readValues("Albuns").catch(() => []);
  const totalLinhas = allRows.length;

  const dump = linhas.map((linha) => {
    const row = allRows[linha - 1] || [];
    return {
      linha,
      rowCru: row,
      porColuna: {
        A_data: row[0],
        B_topicId: row[1],
        C_capa: row[2],
        D_comentariosPara: row[3],
        E_idCriador: row[4],
        F_nomeCriador: row[5],
        G_novoNome: row[6],
        H_metacriticPorJogador: row[7],
        I_mediaMetacritic: row[8],
        J_encarte: row[9],
        K_tipo: row[10],
      },
    };
  });

  return new Response(JSON.stringify({ success: true, totalLinhas, dump }, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

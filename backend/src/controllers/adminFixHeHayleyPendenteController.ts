import { googleSheetsService, normalizeComparison } from "../services/googleSheetsService";
import { mirrorMusicaRowParaD1 } from "./gestaoController";

// Conserto pontual: a primeira tentativa de "marcar como pendente" na
// faixa "He" (Hayley Wonderwall, EMP961, Musicas!linha 792) rodou com o
// código antigo (antes da correção de latência/paralelismo em
// marcarPendenteController) e ficou num estado parcial — confirmado ao
// vivo via diagnostico-comparar-musica-d1: Musicas!B792 (idTopico) e
// X792 (pendente) já tinham sido gravados certo ("" e "Sim"), mas
// F792 (comentariosPara) ficou com o ID do tópico antigo, o espelho D1
// nunca foi re-sincronizado (ainda mostrava pendente=0) e o comentário
// do tópico nunca foi apagado — por isso a 2ª tentativa dava "Tópico não
// encontrado" (a busca por B já estava vazia) em vez de completar o que
// faltava. Esse endpoint termina só o que ficou pela metade, sem mexer
// em mais nada.
//
// GET /api/empire-play/admin/fix-he-hayley-pendente
const MUSICAS_ROW = 792;
const ID_TOPICO_ANTIGO = "musica_1792785481092_f3plki";

export async function adminFixHeHayleyPendenteController(): Promise<Response> {
  const rows = await googleSheetsService.principal.readValues("Musicas", `A${MUSICAS_ROW}:Z${MUSICAS_ROW}`);
  const row = rows?.[0];
  if (!row || (row[7] || "").trim() !== "He") {
    return new Response(
      JSON.stringify({ success: false, error: `Musicas!linha ${MUSICAS_ROW} não é mais "He" — abortado, confira manualmente.` }),
      { status: 409, headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  }

  await googleSheetsService.principal.updateValues("Musicas", `F${MUSICAS_ROW}`, [[""]]);
  await mirrorMusicaRowParaD1(MUSICAS_ROW);

  const comentarios = await googleSheetsService.principal.readValues("Comentarios_Musicas").catch(() => []);
  const idNorm = normalizeComparison(ID_TOPICO_ANTIGO);
  const linhas: number[] = [];
  for (let i = 1; i < comentarios.length; i++) {
    if (normalizeComparison(comentarios[i]?.[0] || "") === idNorm) linhas.push(i + 1);
  }
  if (linhas.length > 0) {
    await googleSheetsService.principal.deleteRows("Comentarios_Musicas", linhas);
  }

  return new Response(
    JSON.stringify({ success: true, data: { comentariosApagados: linhas.length } }, null, 2),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
}

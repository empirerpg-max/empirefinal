import { sheetsService } from "../services/sheetsService";
import { normalizeComparison } from "../services/googleSheetsService";

// Conserto único (não é uma rota de uso recorrente) dos comentários do
// "Bad Friend" (Anníbal) que ficaram presos em IDs de tópico fantasma —
// gerados por posição de linha (idx200/idx215) antes da correção em
// buildCleanItem() que agora usa o Código único como fallback estável.
// Identifica cada linha pelo ID de tópico velho + jogador + trecho do
// comentário (não só pelo ID velho sozinho) pra nunca arriscar corrigir a
// linha errada, mesmo que outro comentário reaproveite o mesmo ID fantasma
// no futuro.
const CORRECOES: {
  sheet: "Comentarios_MV" | "Comentarios_Musicas";
  idAntigo: string;
  idNovo: string;
  jogador: string;
  trechoComentario: string;
}[] = [
  {
    sheet: "Comentarios_MV",
    idAntigo: "videos_idx215",
    idNovo: "video_1789042741749_eip913",
    jogador: "Daniel",
    trechoComentario: "tudo que eu esperava",
  },
  {
    sheet: "Comentarios_MV",
    idAntigo: "videos_idx215",
    idNovo: "video_1789042741749_eip913",
    jogador: "Chris",
    trechoComentario: "energia melancólica",
  },
  {
    sheet: "Comentarios_MV",
    idAntigo: "videos_video_1789044375338_6eyy30",
    idNovo: "video_1789518038039_8pye4f",
    jogador: "Chris",
    trechoComentario: "parabéns pelo empenho",
  },
  {
    sheet: "Comentarios_Musicas",
    idAntigo: "musicas_idx200",
    idNovo: "musica_1789042629124_k6q3vw",
    jogador: "",
    trechoComentario: "",
  },
];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

/**
 * GET /api/empire-play/admin/fix-bad-friend-comments
 * Rota de uso único, sem efeito colateral em nenhuma outra linha: só
 * escreve na célula "ID do tópico" das linhas que baterem com id velho +
 * jogador + trecho do texto. Idempotente — rodar de novo não faz nada
 * (já não vai achar mais nenhuma linha com o id velho).
 */
export async function adminFixOrphanCommentsController(): Promise<Response> {
  const resultados: any[] = [];

  for (const correcao of CORRECOES) {
    const rows = await sheetsService.readValues(correcao.sheet);
    const header = rows[0] || [];
    const colTopico = header.findIndex((h) => normalizeComparison(h).includes("topico"));
    const colJogador = header.findIndex((h) => normalizeComparison(h).includes("nome") && normalizeComparison(h).includes("jogador"));
    const colComentario = header.findIndex((h) => normalizeComparison(h).includes("comentario"));

    if (colTopico < 0) {
      resultados.push({ ...correcao, ok: false, erro: "Coluna 'ID do tópico' não encontrada." });
      continue;
    }

    let encontrou = false;
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const topicoVal = normalizeComparison(row[colTopico] || "");
      if (topicoVal !== normalizeComparison(correcao.idAntigo)) continue;

      if (correcao.jogador) {
        const jogadorVal = normalizeComparison(row[colJogador] || "");
        if (!jogadorVal.includes(normalizeComparison(correcao.jogador))) continue;
      }
      if (correcao.trechoComentario) {
        const comentarioVal = normalizeComparison(row[colComentario] || "");
        if (!comentarioVal.includes(normalizeComparison(correcao.trechoComentario))) continue;
      }

      const colunaLetra = String.fromCharCode(65 + colTopico);
      await sheetsService.updateValues(correcao.sheet, `${colunaLetra}${i + 1}`, [[correcao.idNovo]]);
      resultados.push({ ...correcao, ok: true, linha: i + 1 });
      encontrou = true;
      break;
    }

    if (!encontrou) {
      resultados.push({ ...correcao, ok: false, erro: "Nenhuma linha encontrada (já corrigido antes?)." });
    }
  }

  return jsonResponse({ success: true, resultados });
}

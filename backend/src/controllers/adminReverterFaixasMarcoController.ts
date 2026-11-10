import { googleSheetsService, normalizeComparison } from "../services/googleSheetsService";
import { registrarLogSistema } from "../services/logSistemaService";
import { getCatalogoDb } from "../services/catalogoDbService";

// One-off (2026-11-10): 3 das 4 faixas do álbum "Marco - NeuroDance"
// migradas como pendentes (Intro (feat Isla), SSS, NeuroDance — linhas
// 836/837/838 de "Musicas") foram publicadas de verdade (tópico criado,
// Pendente?="Não") sem que fosse essa a intenção — confirmado com o
// usuário: só "Arthur Morgan" (linha 839) devia mesmo virar single de
// verdade; as outras 3 devem voltar a pendente, mas MANTENDO a letra que
// já foi escrita nelas (letra é lida de dentro do tópico do álbum, não
// depende da faixa estar publicada).
//
// Reverte, por linha de Musicas:
//  - X (Pendente?) -> "Sim"
//  - B, F (ID do tópico) -> "" (remove o tópico criado)
//  - I (Tipo Single) -> "TRACKLIST ALBUM" só pra linha 836 (Intro virou
//    "LEAD SINGLE" ao publicar; as outras já estavam "TRACKLIST ALBUM")
// E no EDIÇÃO CHARTS (achado pelo Código único, coluna Z de Musicas):
//  - F (WEEKS) -> volta pro valor de antes do publish (Musicas!L guarda
//    esse mesmo número, copiado na migração antes de qualquer publish)
//  - C (Tipo Single) -> "TRACKLIST ALBUM" só pra linha 836
// D1 `musicas` (best-effort): pendente=1, id_topico=NULL pelo código único.
//
// GET /api/gestao/admin/reverter-faixas-marco?confirmar=1
const LINHAS_ALVO = [836, 837, 838] as const;

export async function adminReverterFaixasMarcoController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const confirmar = url.searchParams.get("confirmar") === "1";

  try {
    const musicasRows = await googleSheetsService.principal.readValues("Musicas", "A1:AE20000");
    const edicaoChartsRows = await googleSheetsService.edicaoCharts.readValues("EDIÇÃO CHARTS", "A2:BD20000");

    const resultado: any[] = [];

    for (const linha of LINHAS_ALVO) {
      const row = musicasRows[linha - 1];
      if (!row) {
        resultado.push({ linha, erro: "Linha não encontrada." });
        continue;
      }
      const titulo = row[7] || "";
      const codigoUnico = (row[25] || "").trim();
      const weeksOriginal = (row[11] || "").trim(); // Musicas!L, copiado na migração antes do publish
      const tipoSingleAtual = row[8] || "";
      const precisaCorrigirTipoSingle = linha === 836 && tipoSingleAtual !== "TRACKLIST ALBUM";

      // Acha a linha em EDIÇÃO CHARTS pelo Código único (BD = índice 55).
      let linhaEdicaoCharts: number | null = null;
      for (let i = 0; i < edicaoChartsRows.length; i++) {
        if (normalizeComparison(edicaoChartsRows[i]?.[55] || "") === normalizeComparison(codigoUnico)) {
          linhaEdicaoCharts = i + 2;
          break;
        }
      }

      const acao = {
        linha,
        titulo,
        codigoUnico,
        topicIdAtual: row[1] || "",
        weeksRestaurado: weeksOriginal,
        corrigeTipoSingleParaTracklistAlbum: precisaCorrigirTipoSingle,
        linhaEdicaoCharts,
      };
      resultado.push(acao);

      if (confirmar) {
        await googleSheetsService.principal.updateValues("Musicas", `B${linha}`, [[""]]);
        await googleSheetsService.principal.updateValues("Musicas", `F${linha}`, [[""]]);
        await googleSheetsService.principal.updateValues("Musicas", `X${linha}`, [["Sim"]]);
        if (precisaCorrigirTipoSingle) {
          await googleSheetsService.principal.updateValues("Musicas", `I${linha}`, [["TRACKLIST ALBUM"]]);
        }
        if (linhaEdicaoCharts) {
          if (weeksOriginal) {
            await googleSheetsService.edicaoCharts
              .updateValues("EDIÇÃO CHARTS", `F${linhaEdicaoCharts}`, [[weeksOriginal]])
              .catch(() => {});
          }
          if (precisaCorrigirTipoSingle) {
            await googleSheetsService.edicaoCharts
              .updateValues("EDIÇÃO CHARTS", `C${linhaEdicaoCharts}`, [["TRACKLIST ALBUM"]])
              .catch(() => {});
          }
        }
        const db = getCatalogoDb();
        if (db && codigoUnico) {
          await db
            .prepare("UPDATE musicas SET pendente = 1, id_topico = NULL WHERE codigo_unico = ?")
            .bind(codigoUnico)
            .run()
            .catch(() => {});
        }
      }
    }

    if (confirmar) {
      registrarLogSistema({
        categoria: "Ação concluída",
        oQueAconteceu: `[admin] Revertidas pra pendente 3 faixas do álbum "Marco - NeuroDance" que tinham sido publicadas sem essa intenção (Intro (feat Isla), SSS, NeuroDance) — Arthur Morgan mantida publicada de verdade (lançamento de single intencional). Letras escritas nas 3 faixas foram preservadas.`,
        onde: "adminReverterFaixasMarcoController",
      }).catch(() => {});
    }

    return new Response(JSON.stringify({ success: true, confirmar, resultado }, null, 2), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ success: false, error: error.message || "Erro ao reverter." }), {
      status: 500,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }
}

import { googleSheetsService, normalizeComparison, normalizeText } from "../services/googleSheetsService";

// Só leitura. Jogador Wesley relatou que um comentário no álbum DERBY
// (Cowboy Fresh) sumiu logo depois de comentar. Lê o topicId REAL do
// álbum hoje em "Albuns" e as últimas linhas de "Comentarios_Albuns" pra
// comparar — se o comentário foi salvo com um topicId DIFERENTE do que a
// tela do álbum lê hoje (ex: página do jogador ainda carregada com o
// topicId de uma das cópias duplicadas já apagadas na limpeza de hoje),
// o comentário existe mas fica "invisível" porque ninguém mais busca por
// aquele id.
export async function adminDiagComentarioSumidoController(): Promise<Response> {
  const albunsRows = await googleSheetsService.principal.readValues("Albuns", "A1:Z20000").catch(() => []);
  let topicIdAtual = "";
  let linhaAlbum = -1;
  for (let i = 1; i < albunsRows.length; i++) {
    const row = albunsRows[i];
    if (!row) continue;
    const nome = normalizeComparison(normalizeText(row[6]));
    if (nome.includes("cowboy fresh") && nome.includes("derby")) {
      topicIdAtual = normalizeText(row[1]);
      linhaAlbum = i + 1;
      break;
    }
  }

  const comentariosRows = await googleSheetsService.principal.readValues("Comentarios_Albuns").catch(() => []);
  const ultimos20 = comentariosRows.slice(-20).map((row, i) => ({
    linha: comentariosRows.length - 20 + i + 1,
    row,
  }));

  const relacionadosAoDerby = comentariosRows
    .map((row, i) => ({ linha: i + 1, row }))
    .filter(({ row }) => {
      const texto = normalizeComparison((row || []).join(" | "));
      return texto.includes(normalizeComparison(topicIdAtual)) || texto.includes("wesley");
    });

  return new Response(
    JSON.stringify(
      {
        success: true,
        topicIdAtual,
        linhaAlbum,
        totalComentarios: comentariosRows.length,
        ultimos20,
        relacionadosAoDerbyOuWesley: relacionadosAoDerby,
      },
      null,
      2,
    ),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
}

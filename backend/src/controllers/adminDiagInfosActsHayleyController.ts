import { googleSheetsService, normalizeComparison, normalizeText } from "../services/googleSheetsService";

// Jogador criou a artista "Hayley Wonderwall", trocou a foto e mandou a
// biografia, mas nada aparece no app. Hipótese 1 (já corrigida): a coluna
// G ("foto RESOLVIDA") era uma FÓRMULA da própria planilha, que uma linha
// nova via appendRow nunca herda. Hipótese 2 (corrida entre
// setArtistFotoController/setArtistBiografiaController, cada um fazendo
// seu próprio readValues+findIndex sem lock — mesma classe de bug já visto
// em Usuários/ARTISTAS): se os dois POSTs chegaram quase juntos, cada um
// pode não ter visto a escrita do outro ainda e criado uma linha NOVA
// separada — uma com a foto, outra com a biografia — e getArtistInfoController
// só lê a PRIMEIRA linha que bate, perdendo o que estiver só na segunda.
// Dump de TODAS as linhas que batem com "Hayley Wonderwall" (não só a
// primeira) pra confirmar qual das duas hipóteses é a real.
//
// GET /api/empire-play/admin/diagnostico-infos-acts-hayley
export async function adminDiagInfosActsHayleyController(): Promise<Response> {
  const rows = await googleSheetsService.registrosCharts.readValues("INFOS ACTS").catch(() => []);
  const normAlvo = normalizeComparison("Hayley Wonderwall");

  const achadas: Record<string, unknown>[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    const nomeNorm = normalizeComparison(row[0]);
    if (nomeNorm !== normAlvo && !nomeNorm.includes(normAlvo) && !normAlvo.includes(nomeNorm)) continue;
    const colunas: Record<string, string> = {};
    for (let c = 0; c < Math.max(row.length, 20); c++) {
      colunas[String.fromCharCode(65 + c)] = normalizeText(row[c]);
    }
    achadas.push({
      linha: i + 1,
      A_nome: colunas["A"],
      C_fotoOficial: colunas["C"],
      E_biografia: colunas["E"],
      G_fotoResolvida: colunas["G"],
      I_uploadDono: colunas["I"],
      R_capaDesktop: colunas["R"],
      S_capaMobile: colunas["S"],
    });
  }

  return new Response(
    JSON.stringify({ success: true, totalLinhasEncontradas: achadas.length, achadas }, null, 2),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
}

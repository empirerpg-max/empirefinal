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
// Generalizado (2026-11-06, caso Ashley Spring/Paris Godwin: mesmo
// sintoma — várias tentativas de salvar biografia, "nada acontece") pra
// aceitar qualquer nome via query, em vez de só "Hayley Wonderwall" fixo.
// Dump de TODAS as linhas que batem com o nome (não só a primeira) pra
// confirmar se há linha nenhuma, uma só, ou duplicadas.
//
// GET /api/empire-play/admin/diagnostico-infos-acts-hayley?nomes=Ashley Spring,Paris Godwin
export async function adminDiagInfosActsHayleyController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const nomesParam = url.searchParams.get("nomes") || url.searchParams.get("nome") || "Hayley Wonderwall";
  const nomesAlvo = nomesParam.split(",").map((n) => n.trim()).filter(Boolean);

  const rows = await googleSheetsService.registrosCharts.readValues("INFOS ACTS").catch(() => []);

  const porArtista: Record<string, Record<string, unknown>[]> = {};
  for (const nomeAlvo of nomesAlvo) {
    const normAlvo = normalizeComparison(nomeAlvo);
    const achadas: Record<string, unknown>[] = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row) continue;
      const nomeNorm = normalizeComparison(row[0]);
      if (!nomeNorm || nomeNorm !== normAlvo) continue;
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
    porArtista[nomeAlvo] = achadas;
  }

  return new Response(JSON.stringify({ success: true, porArtista }, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

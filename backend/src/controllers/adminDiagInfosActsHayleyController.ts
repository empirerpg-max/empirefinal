import { googleSheetsService, normalizeComparison, normalizeText } from "../services/googleSheetsService";

// Jogador criou a artista "Hayley Wonderwall", trocou a foto e mandou a
// biografia, mas nada aparece no app. Hipótese: a coluna G ("foto
// RESOLVIDA") de "INFOS ACTS" é uma FÓRMULA da própria planilha (usa I se
// preenchida, senão cai pra C — ver getArtistInfoController), e uma linha
// nova criada via appendRow pelo app NUNCA herda fórmula nenhuma (só
// arrastar manualmente no Sheets propaga) — toda foto de artista novo
// ficaria eternamente vazia até alguém arrastar a fórmula na mão. Dump
// BRUTO de todas as colunas da linha da Hayley (se existir) pra confirmar.
//
// GET /api/empire-play/admin/diagnostico-infos-acts-hayley
export async function adminDiagInfosActsHayleyController(): Promise<Response> {
  const rows = await googleSheetsService.registrosCharts.readValues("INFOS ACTS").catch(() => []);
  const header = rows[0] || [];
  const normAlvo = normalizeComparison("Hayley Wonderwall");
  const idx = rows.slice(1).findIndex((r) => normalizeComparison(r[0]).includes(normAlvo) || normAlvo.includes(normalizeComparison(r[0])));

  if (idx === -1) {
    return new Response(
      JSON.stringify({ success: true, encontrada: false, totalLinhas: rows.length - 1 }, null, 2),
      { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  }

  const row = rows[idx + 1];
  const colunas: Record<string, string> = {};
  for (let c = 0; c < Math.max(row.length, 20); c++) {
    colunas[String.fromCharCode(65 + c)] = normalizeText(row[c]);
  }

  return new Response(
    JSON.stringify(
      {
        success: true,
        encontrada: true,
        linha: idx + 2,
        A_nome: colunas["A"],
        C_fotoOficial: colunas["C"],
        E_biografia: colunas["E"],
        G_fotoResolvida: colunas["G"],
        I_uploadDono: colunas["I"],
        R_capaDesktop: colunas["R"],
        S_capaMobile: colunas["S"],
        todasColunas: colunas,
      },
      null,
      2,
    ),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
}

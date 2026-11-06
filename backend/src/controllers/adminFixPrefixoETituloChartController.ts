import { googleSheetsService, normalizeComparison } from "../services/googleSheetsService";

// Correção geral (não um caso isolado): generaliza o bug achado no
// "CURSED BLESSED" da Samantha Cooper (EMP656). Duas causas raiz, a
// primeira alimentando a segunda:
//
// 1) Musicas!H (Nome da música) perdeu o prefixo "Artista - " em algumas
//    linhas antigas (fica só "CURSED BLESSED" em vez de "Samantha Cooper -
//    CURSED BLESSED") — mesmo bug já documentado em
//    publicarFaixaPendenteController/updateReleaseController, nunca
//    corrigido em lote pras linhas já existentes.
// 2) As abas de chart do Início (Top_50_Spotify/Top_Songs_Apple_Music/
//    Top_Videos_YT) têm colunas PRÓPRIAS de capa/áudio/criador,
//    preenchidas cruzando por "Artista - Título" com Musicas — com o
//    título sem prefixo, o cruzamento falha e essas colunas ficam em
//    branco (nunca "erradas", por isso adminFixVarreduraChartCapasController,
//    que só corrige DIVERGÊNCIA entre valor preenchido x catálogo, não
//    pegava esse caso).
//
// Passo 1: corrige QUALQUER linha de Musicas cujo H não comece com
// "{ACT PRINCIPAL} - " (quando ACT PRINCIPAL está preenchido).
// Passo 2: depois da correção, varre as 3 abas de chart e preenche
// capa_da_musica / link_do_audio / id_do_criador SÓ quando estiverem em
// branco (nunca sobrescreve valor já preenchido — isso continua sendo
// papel do fix de divergência).
//
// GET /api/empire-play/admin/fix-prefixo-e-titulo-chart (dry-run) / ?confirmar=1
export async function adminFixPrefixoETituloChartController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const confirmar = url.searchParams.get("confirmar") === "1";

  // ---------- Passo 1: prefixo em Musicas!H ----------
  const musicasRows = await googleSheetsService.principal.readValues("Musicas");
  const prefixosCorrigidos: { linha: number; antes: string; depois: string }[] = [];
  const entradasMusicas: { sheetName: string; range: string; values: string[][] }[] = [];

  for (let i = 1; i < musicasRows.length; i++) {
    const row = musicasRows[i];
    const titulo = (row[7] || "").trim(); // H
    const artista = (row[13] || "").trim(); // N - ACT PRINCIPAL
    if (!titulo || !artista) continue;
    const prefixoEsperado = `${artista} - `;
    if (normalizeComparison(titulo).startsWith(normalizeComparison(prefixoEsperado))) continue;
    // BUG REAL evitado aqui (achado no dry-run, 2026-11-06): a checagem
    // original só pulava quando o título tinha " - " E não começava com
    // o artista — títulos de colaboração como "Rayna feat. Alexxa Hills -
    // Teenage Rage" ou "SA5M, Raven, Helenna & TED - Hard Core" começam
    // com o artista mas SEM o " - " logo em seguida (vem "feat."/","/"&"/
    // "x" antes do " - " de verdade), então caíam no "corrige" e
    // duplicavam o prefixo ("Rayna - Rayna feat. ..."). A regra certa é
    // simples: se o título JÁ começa com o nome do artista, de qualquer
    // jeito que seja, está bom — só falta prefixo mesmo quando o título
    // não menciona o artista no começo de jeito nenhum.
    if (normalizeComparison(titulo).startsWith(normalizeComparison(artista))) continue;

    const linha = i + 1;
    const novoTitulo = `${prefixoEsperado}${titulo}`;
    prefixosCorrigidos.push({ linha, antes: titulo, depois: novoTitulo });
    if (confirmar) {
      entradasMusicas.push({ sheetName: "Musicas", range: `H${linha}`, values: [[novoTitulo]] });
    }
  }

  if (confirmar && entradasMusicas.length > 0) {
    await googleSheetsService.principal.updateValuesBatch(entradasMusicas);
  }

  // ---------- Passo 2: backfill de branco nas abas de chart ----------
  // Índice por "Artista - Título" (já com o prefixo correto, pós-passo 1)
  // -> capa/áudio/criador reais de Musicas.
  const porChave = new Map<string, { capa: string; audio: string; criador: string }>();
  for (let i = 1; i < musicasRows.length; i++) {
    const row = musicasRows[i];
    const tituloOriginal = (row[7] || "").trim();
    const artista = (row[13] || "").trim();
    if (!tituloOriginal || !artista) continue;
    const corrigido = prefixosCorrigidos.find((p) => p.linha === i + 1);
    const tituloFinal = corrigido ? corrigido.depois : tituloOriginal;
    const chave = normalizeComparison(tituloFinal);
    if (!porChave.has(chave)) {
      porChave.set(chave, {
        capa: (row[3] || "").trim(), // D
        audio: (row[2] || "").trim(), // C
        criador: (row[6] || "").trim(), // G
      });
    }
  }

  const ABAS_CHART = ["Top_50_Spotify", "Top_Songs_Apple_Music", "Top_Videos_YT"];
  const backfillPorAba: Record<
    string,
    { linha: number; nome: string; capa: boolean; audio: boolean; criador: boolean }[]
  > = {};
  const entradasChart: { sheetName: string; range: string; values: string[][] }[] = [];

  for (const aba of ABAS_CHART) {
    const rows = await googleSheetsService.principal.readValues(aba).catch(() => []);
    if (!rows.length) continue;
    const header = rows[0] || [];
    const colNome = header.findIndex((h) => normalizeComparison(h) === normalizeComparison("Nome da Música"));
    const colCapa = header.findIndex((h) => normalizeComparison(h) === normalizeComparison("Capa da Música"));
    const colAudio = header.findIndex((h) => normalizeComparison(h) === normalizeComparison("Link do áudio"));
    const colCriador = header.findIndex((h) => normalizeComparison(h) === normalizeComparison("ID do criador"));
    if (colNome === -1) continue;

    const achados: typeof backfillPorAba[string] = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const nome = (row[colNome] || "").trim();
      if (!nome) continue;
      const real = porChave.get(normalizeComparison(nome));
      if (!real) continue;

      const linha = i + 1;
      let fezCapa = false;
      let fezAudio = false;
      let fezCriador = false;

      if (colCapa !== -1 && real.capa && !(row[colCapa] || "").trim()) {
        fezCapa = true;
        if (confirmar) {
          entradasChart.push({ sheetName: aba, range: `${String.fromCharCode(65 + colCapa)}${linha}`, values: [[real.capa]] });
        }
      }
      if (colAudio !== -1 && real.audio && !(row[colAudio] || "").trim()) {
        fezAudio = true;
        if (confirmar) {
          entradasChart.push({ sheetName: aba, range: `${String.fromCharCode(65 + colAudio)}${linha}`, values: [[real.audio]] });
        }
      }
      if (colCriador !== -1 && real.criador && !(row[colCriador] || "").trim()) {
        fezCriador = true;
        if (confirmar) {
          entradasChart.push({ sheetName: aba, range: `${String.fromCharCode(65 + colCriador)}${linha}`, values: [[real.criador]] });
        }
      }

      if (fezCapa || fezAudio || fezCriador) {
        achados.push({ linha, nome, capa: fezCapa, audio: fezAudio, criador: fezCriador });
      }
    }
    if (achados.length > 0) backfillPorAba[aba] = achados;
  }

  if (confirmar && entradasChart.length > 0) {
    await googleSheetsService.principal.updateValuesBatch(entradasChart);
  }

  return new Response(
    JSON.stringify(
      {
        success: true,
        confirmar,
        prefixosCorrigidos,
        totalPrefixosCorrigidos: prefixosCorrigidos.length,
        backfillPorAba,
      },
      null,
      2,
    ),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
}

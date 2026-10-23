import { googleSheetsService, normalizeText, normalizeComparison } from "../services/googleSheetsService";

// Usuário reportou: "Lançamentos Recentes" ainda mostra FOLLIA duplicado
// e um terceiro card "FOLLIA"/"Max" (artista truncado, capa quebrada).
// Dump de TODAS as linhas de "EDIÇÃO CHARTS" e "EDIÇÃO CHARTS ÁLBUMS"
// cujo texto bruto contenha "folia"/"follia" (case-insensitive,
// substring), com todas as colunas relevantes, pra achar a linha
// corrompida/duplicada que o dedup por id não pegou (por ser um item
// DIFERENTE no catálogo, não uma duplicata de verdade).
//
// GET /api/empire-play/admin/diagnostico-lancamentos-follia
export async function adminDiagLancamentosFolliaController(): Promise<Response> {
  const [musicasRows, albunsRows] = await Promise.all([
    googleSheetsService.edicaoCharts.readValues("EDIÇÃO CHARTS", "A1:BD5000").catch(() => []),
    googleSheetsService.edicaoCharts.readValues("EDIÇÃO CHARTS ÁLBUMS", "A1:R5000").catch(() => []),
  ]);

  const achadasMusicas: Record<string, unknown>[] = [];
  for (let i = 1; i < musicasRows.length; i++) {
    const row = musicasRows[i];
    if (!row) continue;
    const linhaTexto = row.slice(0, 5).map((c) => normalizeText(c)).join(" | ");
    if (!/folia|follia/i.test(linhaTexto)) continue;
    achadasMusicas.push({
      linha: i + 1,
      A_dataLancamento: normalizeText(row[0]),
      B_titulo: normalizeText(row[1]),
      C_tipoSingle: normalizeText(row[2]),
      D_tipoMusica: normalizeText(row[3]),
      E_album: normalizeText(row[4]),
      H_artPrincipal: normalizeText(row[7]),
      BD_codigoUnico: normalizeText(row[55]),
    });
  }

  const achadasAlbuns: Record<string, unknown>[] = [];
  for (let i = 1; i < albunsRows.length; i++) {
    const row = albunsRows[i];
    if (!row) continue;
    const linhaTexto = row.slice(0, 4).map((c) => normalizeText(c)).join(" | ");
    if (!/folia|follia/i.test(linhaTexto)) continue;
    achadasAlbuns.push({
      linha: i + 1,
      A_artista: normalizeText(row[0]),
      B_dataLancamento: normalizeText(row[1]),
      D_nomeAlbum: normalizeText(row[3]),
      R_codigoUnico: normalizeText(row[17]),
    });
  }

  // Também checa a linha real de Musicas pro single "Follia" (EMP930,
  // confirmado em diagnóstico anterior nessa sessão) e a linha de Albuns
  // do FOLLIA (EMPALBM090).
  const musicasPrincipal = await googleSheetsService.principal.readValues("Musicas", "A1:AE2000").catch(() => []);
  const albunsPrincipal = await googleSheetsService.principal.readValues("Albuns", "A1:L200").catch(() => []);
  const linhasMusicasPrincipal: Record<string, unknown>[] = [];
  for (let i = 1; i < musicasPrincipal.length; i++) {
    const row = musicasPrincipal[i];
    if (!row) continue;
    const titulo = normalizeText(row[7]);
    if (!/folia|follia/i.test(titulo)) continue;
    linhasMusicasPrincipal.push({
      linha: i + 1,
      H_titulo: titulo,
      K_album: normalizeText(row[10]),
      N_artPrincipal: normalizeText(row[13]),
      Z_codigoUnico: normalizeText(row[25]),
    });
  }

  return new Response(
    JSON.stringify(
      { success: true, edicaoChartsMusicas: achadasMusicas, edicaoChartsAlbuns: achadasAlbuns, musicasPrincipal: linhasMusicasPrincipal },
      null,
      2,
    ),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
}

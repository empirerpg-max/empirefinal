import { googleSheetsService, normalizeComparison } from "../services/googleSheetsService";

// Diagnóstico pontual (2026-11-12): álbum da Amanda Brokne reportado como
// "todo bugado". Dump de: linha(s) do álbum em "Albuns" (planilha
// principal), TODAS as linhas de "Musicas" cujo título/artista/
// participantes mencionem "Amanda Brokne"/"Brokne", e as linhas
// correspondentes em "EDIÇÃO CHARTS" (onde vive o código único, coluna BD /
// índice 55). Só leitura — não altera nada.
//
// GET /api/gestao/admin/diag-album-amanda-brokne
export async function adminDiagAlbumAmandaBrokneController(): Promise<Response> {
  const bate = (texto: string) => normalizeComparison(texto || "").includes("brokne");

  // --- Albuns (planilha principal) ---
  // Coluna A=data, B=topicId, C=capa, F=index5 (nome do criador), G=index6
  // (titulo, "Artista - Título"), L=index11 (codigoUnico).
  const albunsRows = await googleSheetsService.principal.readValues("Albuns").catch(() => []);
  const linhasAlbuns = albunsRows
    .map((row, i) => ({ linha: i + 1, row }))
    .filter(({ linha, row }) => linha > 1 && (bate(row[6]) || bate(row[5]) || bate(row.join(" "))))
    .map(({ linha, row }) => ({
      linha,
      data: row[0],
      topicId: row[1],
      criador: row[5],
      titulo: row[6],
      codigoUnico: row[11],
    }));

  // --- Musicas (planilha principal) ---
  // Coluna A=data, D=index3 capa, H=index7 titulo, N=index13 ACT PRINCIPAL,
  // O-S=index14-18 participantes, Z=index25 codigoUnico.
  const musicasRows = await googleSheetsService.principal.readValues("Musicas").catch(() => []);
  const linhasMusicas = musicasRows
    .map((row, i) => ({ linha: i + 1, row }))
    .filter(({ linha, row }) => {
      if (linha <= 1) return false;
      const participantes = row.slice(14, 19);
      return bate(row[7]) || bate(row[13]) || participantes.some((p) => bate(p));
    })
    .map(({ linha, row }) => ({
      linha,
      data: row[0],
      titulo: row[7],
      actPrincipal: row[13],
      participantes: row.slice(14, 19),
      codigoUnico: row[25],
    }));

  // --- EDIÇÃO CHARTS (planilha edicaoCharts) ---
  // Coluna B=index1 titulo ("Artista - Título", sempre prefixado),
  // BD=index55 codigoUnico.
  const edicaoRows = await googleSheetsService.edicaoCharts.readValues("EDIÇÃO CHARTS").catch(() => []);
  const codigosMusicas = new Set(
    linhasMusicas.map((m) => normalizeComparison(String(m.codigoUnico || ""))).filter(Boolean),
  );
  const linhasEdicaoCharts = edicaoRows
    .map((row, i) => ({ linha: i + 1, row }))
    .filter(({ linha, row }) => {
      if (linha <= 1) return false;
      const codigo = normalizeComparison(String(row[55] || ""));
      return bate(row[1]) || (codigo && codigosMusicas.has(codigo));
    })
    .map(({ linha, row }) => ({
      linha,
      titulo: row[1],
      codigoUnico: row[55],
    }));

  return new Response(
    JSON.stringify(
      {
        success: true,
        totalLinhasAlbuns: albunsRows.length,
        totalLinhasMusicas: musicasRows.length,
        totalLinhasEdicaoCharts: edicaoRows.length,
        linhasAlbuns,
        linhasMusicas,
        linhasEdicaoCharts,
      },
      null,
      2,
    ),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
}

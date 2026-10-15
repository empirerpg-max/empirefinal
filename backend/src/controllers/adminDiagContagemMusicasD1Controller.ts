import { getCatalogoDb } from "../services/catalogoDbService";
import { googleSheetsService, normalizeText, normalizeComparison } from "../services/googleSheetsService";

// Diagnóstico read-only: getEmpirePlayMusicasController (Catálogo/Fórum)
// devolveu só 196 itens em produção depois do pivot pra D1, quando o
// esperado era ~766 (772 migradas - ~6 sem título/pendente de verdade) —
// investiga se é a contagem real da tabela, o campo `pendente`, ou outra
// coisa filtrando demais.
//
// GET /api/empire-play/admin/diagnostico-contagem-musicas-d1
export async function adminDiagContagemMusicasD1Controller(): Promise<Response> {
  const db = getCatalogoDb();
  if (!db) {
    return new Response(JSON.stringify({ success: false, error: "Binding CATALOGO_DB não disponível." }), {
      status: 500,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  const total = await db.prepare("SELECT COUNT(*) as n FROM musicas").all<{ n: number }>();
  const pendentes = await db
    .prepare("SELECT COUNT(*) as n FROM musicas WHERE pendente = 1")
    .all<{ n: number }>();
  const semTitulo = await db
    .prepare("SELECT COUNT(*) as n FROM musicas WHERE titulo IS NULL OR titulo = ''")
    .all<{ n: number }>();
  const amostra = await db.prepare("SELECT codigo_unico, id_topico, titulo, pendente FROM musicas LIMIT 10").all();

  // Comparação com a FONTE DE VERDADE (Sheets) — pra saber se o D1 só está
  // refletindo um crescimento real de faixas pendentes (jogo rodou,
  // álbuns novos criados com faixas sem tópico aberto) ou se é um bug de
  // sincronização nos hooks de escrita (ver gestaoController.ts).
  const sheetRows = await googleSheetsService.principal.readValues("Musicas", "A:X").catch(() => []);
  let sheetsTotal = 0;
  let sheetsPendentes = 0;
  // Datas das linhas pendentes — pra saber se é backlog histórico (datas
  // espalhadas no passado) ou algo recém-criado numa rajada (datas de
  // hoje concentradas), o que apontaria causas bem diferentes.
  const datasPendentes: string[] = [];
  const albunsPendentes = new Map<string, number>();
  const amostraDivergente: { linha: number; titulo: string; pendenteSheets: string; emD1: boolean; pendenteD1: number | null }[] = [];
  const codigosD1 = await db.prepare("SELECT codigo_unico, pendente FROM musicas").all<{ codigo_unico: string; pendente: number }>();
  const mapaD1 = new Map((codigosD1.results || []).map((r) => [r.codigo_unico, r.pendente]));
  const codigoPorLinha = await googleSheetsService.principal.readValues("Musicas", "Z:Z").catch(() => []);
  for (let i = 1; i < sheetRows.length; i++) {
    const row = sheetRows[i];
    if (!row || !row.some((c) => normalizeText(c))) continue;
    sheetsTotal++;
    const pendenteSheets = normalizeComparison(normalizeText(row[23])) === "sim";
    if (pendenteSheets) {
      sheetsPendentes++;
      datasPendentes.push(normalizeText(row[0]) || "(sem data)");
      const album = normalizeText(row[10]) || "(sem álbum)";
      albunsPendentes.set(album, (albunsPendentes.get(album) || 0) + 1);
    }
    const codigo = normalizeText(codigoPorLinha[i]?.[0]);
    const pendenteD1 = codigo && mapaD1.has(codigo) ? mapaD1.get(codigo)! : null;
    const divergente = codigo && mapaD1.has(codigo) && (pendenteD1 === 1) !== pendenteSheets;
    if (divergente && amostraDivergente.length < 15) {
      amostraDivergente.push({
        linha: i + 1,
        titulo: normalizeText(row[7]),
        pendenteSheets: row[23] || "",
        emD1: mapaD1.has(codigo),
        pendenteD1,
      });
    }
  }

  return new Response(
    JSON.stringify(
      {
        success: true,
        d1: {
          totalNaTabela: total.results?.[0]?.n ?? null,
          comPendenteIgual1: pendentes.results?.[0]?.n ?? null,
          semTitulo: semTitulo.results?.[0]?.n ?? null,
        },
        sheets: {
          total: sheetsTotal,
          comPendenteSim: sheetsPendentes,
          distribuicaoDatasPendentes: datasPendentes.reduce(
            (acc, d) => {
              acc[d] = (acc[d] || 0) + 1;
              return acc;
            },
            {} as Record<string, number>,
          ),
          top10AlbunsComMaisPendentes: [...albunsPendentes.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10),
        },
        amostraDivergente,
        amostra: amostra.results,
      },
      null,
      2,
    ),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
}

import { googleSheetsService, normalizeComparison, normalizeText } from "../services/googleSheetsService";
import { getCatalogoDb } from "../services/catalogoDbService";

// Segunda passada da limpeza do DERBY (ver adminLimparFaixasDuplicadasDerbyController):
// aquela limpeza cruzava "EDIÇÃO CHARTS" com as duplicatas de "Musicas"
// pelo Código único (Musicas!Z <-> EDIÇÃO CHARTS!BD) — mas a faixa
// "Tequerdad" NUNCA teve Código único gerado em nenhuma das ~64
// publicações (bug à parte, ainda não investigado), então nenhuma cópia
// dela foi removida de EDIÇÃO CHARTS por esse cruzamento. Essa segunda
// passada ignora Código único inteiramente e casa DIRETO por
// (Álbum + Música) dentro da própria aba EDIÇÃO CHARTS — mais robusto,
// cobre qualquer duplicata que tenha sobrado por qualquer motivo. Também
// limpa o espelho D1 (`midia`, tipo='musica') pra artista="Cowboy Fresh"
// com os 3 títulos conhecidos do álbum.
//
// Escopo fechado: só Cowboy Fresh/DERBY — nunca Follia/Max Gorghan.
//
// GET /api/empire-play/admin/limpar-restante-derby?confirmar=1
export async function adminLimparRestanteDerbyController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const confirmar = url.searchParams.get("confirmar") === "1";
  const ARTISTA = "cowboy fresh";
  const ALBUM = "derby";

  // 1) EDIÇÃO CHARTS — casa por (Álbum + Música), não por Código único.
  const edicaoRows = await googleSheetsService.edicaoCharts.readValues("EDIÇÃO CHARTS", "A1:BD20000").catch(() => []);
  type Linha = { linha: number; musica: string; album: string };
  const porGrupo = new Map<string, Linha[]>();
  for (let i = 1; i < edicaoRows.length; i++) {
    const row = edicaoRows[i];
    if (!row) continue;
    const musica = normalizeText(row[1]); // B
    const album = normalizeText(row[4]); // E
    const albumNorm = normalizeComparison(album);
    if (!albumNorm.includes(ARTISTA) || !albumNorm.includes(ALBUM)) continue;
    const chave = normalizeComparison(musica);
    const item: Linha = { linha: i + 1, musica, album };
    const grupo = porGrupo.get(chave) || [];
    grupo.push(item);
    porGrupo.set(chave, grupo);
  }

  const manterEdicao: Linha[] = [];
  const duplicatasEdicao: Linha[] = [];
  for (const grupo of porGrupo.values()) {
    grupo.sort((a, b) => a.linha - b.linha);
    manterEdicao.push(grupo[0]);
    duplicatasEdicao.push(...grupo.slice(1));
  }

  // 2) D1 (`midia`, tipo='musica') — mesma lógica, casa por artista+título,
  // mantém a linha de `criado_em` mais antiga.
  const db = getCatalogoDb();
  let d1Grupos: { titulo: string; manter: string | null; duplicatas: string[] }[] = [];
  if (db) {
    try {
      const res = await db
        .prepare(
          `SELECT id, titulo, criado_em FROM midia WHERE tipo = 'musica' AND lower(artista) = ? ORDER BY titulo, criado_em ASC`,
        )
        .bind("cowboy fresh")
        .all<{ id: string; titulo: string; criado_em: string }>();
      const porTitulo = new Map<string, { id: string; titulo: string; criado_em: string }[]>();
      for (const r of res.results || []) {
        const titNorm = normalizeComparison(r.titulo);
        if (!titNorm.includes(ALBUM) && !["el traidor", "nosotros", "tequerdad"].some((t) => titNorm.includes(t))) continue;
        const grupo = porTitulo.get(titNorm) || [];
        grupo.push(r);
        porTitulo.set(titNorm, grupo);
      }
      for (const [titulo, grupo] of porTitulo) {
        d1Grupos.push({
          titulo,
          manter: grupo[0]?.id || null,
          duplicatas: grupo.slice(1).map((g) => g.id),
        });
      }
    } catch (err) {
      console.warn("[adminLimparRestanteDerbyController] Falha ao consultar D1:", err);
    }
  }

  const resultado: {
    confirmar: boolean;
    edicaoCharts: { manter: Linha[]; duplicatas: Linha[] };
    d1: typeof d1Grupos;
    edicaoChartsRemovidas?: number;
    d1Removidas?: number;
    erros: string[];
  } = {
    confirmar,
    edicaoCharts: { manter: manterEdicao, duplicatas: duplicatasEdicao },
    d1: d1Grupos,
    erros: [],
  };

  if (!confirmar) {
    return new Response(JSON.stringify(resultado, null, 2), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  try {
    if (duplicatasEdicao.length > 0) {
      await googleSheetsService.edicaoCharts.deleteRows("EDIÇÃO CHARTS", duplicatasEdicao.map((d) => d.linha));
    }
    resultado.edicaoChartsRemovidas = duplicatasEdicao.length;
  } catch (err: any) {
    resultado.erros.push(`Falha ao apagar duplicatas em EDIÇÃO CHARTS: ${err?.message || err}`);
  }

  if (db) {
    let removidas = 0;
    for (const grupo of d1Grupos) {
      for (const id of grupo.duplicatas) {
        try {
          await db.prepare(`DELETE FROM midia WHERE id = ? AND tipo = 'musica'`).bind(id).run();
          removidas++;
        } catch (err: any) {
          resultado.erros.push(`Falha ao apagar midia id=${id}: ${err?.message || err}`);
        }
      }
    }
    resultado.d1Removidas = removidas;
  }

  return new Response(JSON.stringify(resultado, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

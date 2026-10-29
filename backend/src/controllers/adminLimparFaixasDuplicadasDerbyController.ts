import { googleSheetsService, normalizeComparison, normalizeText } from "../services/googleSheetsService";
import { getCatalogoDb } from "../services/catalogoDbService";

// Mesma lógica do bug do álbum (ver adminLimparDuplicadosDerbyController),
// só que nas FAIXAS: cada uma das ~63 publicações duplicadas do álbum
// "DERBY" (Cowboy Fresh) rodou processarFaixasDoAlbum de novo, criando um
// novo conjunto de linhas em "Musicas" (coluna K = "Cowboy Fresh - DERBY"
// em TODAS as cópias) e em "EDIÇÃO CHARTS" (edicaoCharts) pra cada faixa.
// Escopo FECHADO: só Cowboy Fresh/DERBY — NUNCA Follia/Max Gorghan.
//
// Estratégia: agrupa as linhas de "Musicas" que pertencem ao álbum DERBY
// por (Ordem + Nome da música) — cada grupo representa a MESMA faixa
// publicada repetidamente. Mantém a linha de MENOR número (a primeira
// gravada, já que appendRowMusicasComCursor sempre escreve em ordem
// sequencial de publicação) e marca o resto como duplicata. Depois cruza
// o "Código único" (Musicas!Z) de cada duplicata com "EDIÇÃO CHARTS!BD"
// pra apagar a linha espelhada lá, e tenta limpar o D1 (tabela `musicas`)
// pelas mesmas chaves (best-effort, D1 é só espelho).
//
// GET /api/empire-play/admin/limpar-faixas-duplicadas-derby?confirmar=1
export async function adminLimparFaixasDuplicadasDerbyController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const confirmar = url.searchParams.get("confirmar") === "1";
  const ARTISTA = "cowboy fresh";
  const ALBUM = "derby";

  const musicasRows = await googleSheetsService.principal.readValues("Musicas", "A1:AE50000").catch(() => []);
  type Faixa = { linha: number; ordem: string; titulo: string; codigoUnico: string };
  const porGrupo = new Map<string, Faixa[]>();
  for (let i = 1; i < musicasRows.length; i++) {
    const row = musicasRows[i];
    if (!row) continue;
    const album = normalizeComparison(normalizeText(row[10])); // K
    if (!album.includes(ARTISTA) || !album.includes(ALBUM)) continue;
    const ordem = normalizeText(row[20]); // U
    const titulo = normalizeText(row[7]); // H
    const codigoUnico = normalizeText(row[25]); // Z
    const chave = `${ordem}::${normalizeComparison(titulo)}`;
    const faixa: Faixa = { linha: i + 1, ordem, titulo, codigoUnico };
    const grupo = porGrupo.get(chave) || [];
    grupo.push(faixa);
    porGrupo.set(chave, grupo);
  }

  const manter: Faixa[] = [];
  const duplicatas: Faixa[] = [];
  for (const grupo of porGrupo.values()) {
    grupo.sort((a, b) => a.linha - b.linha);
    manter.push(grupo[0]);
    duplicatas.push(...grupo.slice(1));
  }

  if (duplicatas.length === 0) {
    return new Response(
      JSON.stringify({ success: true, mensagem: "Nenhuma faixa duplicada de DERBY/Cowboy Fresh encontrada em Musicas.", grupos: porGrupo.size, manter }, null, 2),
      { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  }

  const resultado: {
    confirmar: boolean;
    grupos: number;
    manter: Faixa[];
    duplicatasMusicas: Faixa[];
    edicaoChartsRemovidas?: number;
    d1Removidas?: number;
    erros: string[];
  } = {
    confirmar,
    grupos: porGrupo.size,
    manter,
    duplicatasMusicas: duplicatas,
    erros: [],
  };

  if (!confirmar) {
    return new Response(JSON.stringify(resultado, null, 2), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  // 1) Apaga as linhas duplicadas em "Musicas".
  try {
    await googleSheetsService.principal.deleteRows("Musicas", duplicatas.map((d) => d.linha));
  } catch (err: any) {
    resultado.erros.push(`Falha ao apagar linhas duplicadas em Musicas: ${err?.message || err}`);
  }

  // 2) Apaga as linhas espelhadas em "EDIÇÃO CHARTS" (cruza por Código
  // único, coluna BD — índice 54 lendo a partir de B, ver
  // atualizarFaixaNosChartsAoPublicar em gestaoController.ts).
  const codigosDuplicados = new Set(duplicatas.map((d) => normalizeComparison(d.codigoUnico)).filter(Boolean));
  try {
    if (codigosDuplicados.size > 0) {
      const edicaoRows = await googleSheetsService.edicaoCharts.readValues("EDIÇÃO CHARTS", "B2:BD20000").catch(() => []);
      const linhasParaApagar: number[] = [];
      for (let i = 0; i < edicaoRows.length; i++) {
        const row = edicaoRows[i];
        if (!row) continue;
        const codigo = normalizeComparison(normalizeText(row[54])); // BD, 0-based a partir de B
        if (codigo && codigosDuplicados.has(codigo)) {
          linhasParaApagar.push(i + 2); // B2 começa na linha 2 da planilha
        }
      }
      if (linhasParaApagar.length > 0) {
        await googleSheetsService.edicaoCharts.deleteRows("EDIÇÃO CHARTS", linhasParaApagar);
      }
      resultado.edicaoChartsRemovidas = linhasParaApagar.length;
    } else {
      resultado.edicaoChartsRemovidas = 0;
    }
  } catch (err: any) {
    resultado.erros.push(`Falha ao apagar linhas duplicadas em EDIÇÃO CHARTS: ${err?.message || err}`);
  }

  // 3) Limpa o espelho D1 (tabela `midia`, ver d1/schema.sql — guarda
  // músicas E álbuns, discriminados por `tipo`) pelas mesmas chaves —
  // best-effort, nunca é a fonte de verdade (ver catalogoDbService.ts).
  try {
    const db = getCatalogoDb();
    if (db && codigosDuplicados.size > 0) {
      let removidas = 0;
      for (const codigo of duplicatas.map((d) => d.codigoUnico).filter(Boolean)) {
        try {
          await db.prepare(`DELETE FROM midia WHERE codigo_unico = ? AND tipo = 'musica'`).bind(codigo).run();
          removidas++;
        } catch {
          // best-effort, D1 nunca bloqueia a limpeza real (Sheets)
        }
      }
      resultado.d1Removidas = removidas;
    }
  } catch (err: any) {
    resultado.erros.push(`Falha ao limpar D1 (midia): ${err?.message || err}`);
  }

  return new Response(JSON.stringify(resultado, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

import {
  readValues,
  updateValues,
  ensureSheetTab,
  listSheetTabs,
  spreadsheetBatchUpdate,
  normalizeText,
  normalizeComparison,
} from "../services/googleSheetsService";
import { PREMIACOES_INDICAR } from "./indicacoesController";
import {
  lerFaseVotacao,
  lerCategoriasVotacao,
  carregarBlocoDaCategoria,
  parseBlocos,
  scoreNota,
  scoreVoto,
  type IndicadoBloco,
} from "./votacaoController";
import { getOwnerIdForArtist } from "./artistasController";
import { resolveNomeOficial } from "./forumController";

// Gera (ou regenera) a aba "Resultados (sem autovoto)" na planilha do VMA
// (mesma usada por Indicar/Votação, ver PREMIACOES_INDICAR) — por
// categoria, em ordem ALFABÉTICA de indicado, mostra o número de votos
// (categorias "por votação") ou a nota média (categorias "por nota"),
// destacando o(s) vencedor(es) (maior score; empate = mais de um
// vencedor destacado).
//
// Regra explícita combinada com o usuário: um jogador não pode contar o
// PRÓPRIO voto num material de um artista que ele mesmo possui (ex: Lucas
// B. não conta se votar na Rayna, caso ele seja o dono dela) — essas
// células são excluídas do cálculo de score (nota/voto), mas a aba de
// votação original (Indicações_Voto/Indicações_VotoPorNota) nunca é
// alterada, só lida.
//
// ?dryRun=1 só devolve o resultado calculado em JSON, sem escrever a aba.
// GET /api/empire-play/admin/gerar-resultados-vma?dryRun=1
export async function adminGerarResultadosVmaController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const dryRun = url.searchParams.get("dryRun") === "1";
  const awardId = PREMIACOES_INDICAR[0];
  const SHEET_RESULTADOS = "Resultados (sem autovoto)";

  const detalhes = await lerFaseVotacao(awardId);
  if (!detalhes) {
    return new Response(JSON.stringify({ success: false, error: "Fase de votação não encontrada." }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }
  const categorias = await lerCategoriasVotacao(awardId);

  // Monta o mapa artista -> nome de jogador do DONO, uma vez só (evita
  // repetir a mesma busca pra cada indicado/categoria que compartilha
  // artista).
  const blocosPorCategoria: { categoria: string; tipo: "nota" | "voto"; bloco: ReturnType<typeof parseBlocos>[number] | undefined }[] = [];
  const artistasUnicos = new Set<string>();
  for (const cat of categorias) {
    const { bloco } = await carregarBlocoDaCategoria(awardId, detalhes, cat);
    blocosPorCategoria.push({ categoria: cat.categoria, tipo: cat.tipo, bloco });
    if (bloco) {
      for (const ind of bloco.indicados) {
        if (ind.artista) artistasUnicos.add(ind.artista);
      }
    }
  }

  const donoPorArtista = new Map<string, string>();
  await Promise.all(
    Array.from(artistasUnicos).map(async (artista) => {
      const ownerId = await getOwnerIdForArtist(artista).catch(() => "");
      if (!ownerId) return;
      const ownerNome = await resolveNomeOficial(ownerId, "").catch(() => "");
      if (ownerNome) donoPorArtista.set(normalizeComparison(artista), normalizeComparison(ownerNome));
    }),
  );

  interface LinhaResultado {
    titulo: string;
    artista: string;
    score: number;
    scoreDisplay: string;
    vencedor: boolean;
  }
  interface CategoriaResultado {
    categoria: string;
    tipo: "nota" | "voto";
    linhas: LinhaResultado[];
    autovotosExcluidos: number;
  }

  const resultados: CategoriaResultado[] = [];

  for (const { categoria, tipo, bloco } of blocosPorCategoria) {
    if (!bloco || bloco.indicados.length === 0) {
      resultados.push({ categoria, tipo, linhas: [], autovotosExcluidos: 0 });
      continue;
    }

    let autovotosExcluidos = 0;
    const comScoreFiltrado = bloco.indicados.map((ind: IndicadoBloco) => {
      const donoNorm = donoPorArtista.get(normalizeComparison(ind.artista));
      const valoresFiltrados = ind.valores.map((v, idx) => {
        if (!v) return v;
        const jogadorColuna = normalizeComparison(bloco.colunas[idx]);
        if (donoNorm && jogadorColuna && jogadorColuna === donoNorm) {
          autovotosExcluidos++;
          return "";
        }
        return v;
      });
      const score = tipo === "nota" ? scoreNota(valoresFiltrados) : scoreVoto(valoresFiltrados);
      return { titulo: ind.titulo, artista: ind.artista, score };
    });

    // "São 6 por categoria" — pega só os 6 de maior score (a aba de
    // votação real guarda TODOS os indicados originais, não só os 6
    // oficiais), e só DEPOIS ordena esses 6 alfabeticamente pra exibição.
    const top6 = [...comScoreFiltrado].sort((a, b) => b.score - a.score).slice(0, 6);
    const maiorScore = Math.max(...top6.map((r) => r.score));
    const linhas: LinhaResultado[] = top6
      .map((r) => ({
        titulo: r.titulo,
        artista: r.artista,
        score: r.score,
        scoreDisplay:
          tipo === "nota"
            ? r.score < 0
              ? "Sem notas"
              : r.score.toFixed(2).replace(".", ",")
            : String(r.score),
        vencedor: r.score === maiorScore && r.score > (tipo === "nota" ? -1 : 0),
      }))
      .sort((a, b) => a.titulo.localeCompare(b.titulo, "pt-BR", { sensitivity: "base" }));

    resultados.push({ categoria, tipo, linhas, autovotosExcluidos });
  }

  if (dryRun) {
    return new Response(JSON.stringify({ success: true, dryRun: true, resultados }, null, 2), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  // Monta a matriz final + registra os índices (0-based) das linhas de
  // categoria/cabeçalho/vencedor pra formatar depois.
  const matriz: string[][] = [];
  const linhasCategoria: number[] = [];
  const linhasHeader: number[] = [];
  const linhasVencedor: number[] = [];

  for (const cat of resultados) {
    linhasCategoria.push(matriz.length);
    matriz.push([cat.categoria.toUpperCase(), "", "", ""]);
    linhasHeader.push(matriz.length);
    matriz.push(["INDICADO", "ARTISTA", cat.tipo === "nota" ? "NOTA MÉDIA" : "VOTOS", "VENCEDOR"]);
    for (const linha of cat.linhas) {
      if (linha.vencedor) linhasVencedor.push(matriz.length);
      matriz.push([linha.titulo, linha.artista, linha.scoreDisplay, linha.vencedor ? "🏆 VENCEDOR" : ""]);
    }
    matriz.push(["", "", "", ""]);
  }

  await ensureSheetTab(awardId, SHEET_RESULTADOS);
  // Limpa a aba inteira antes de regravar (pra regenerar do zero sem
  // deixar sobra de uma execução anterior com mais linhas que a atual).
  await updateValues(
    awardId,
    SHEET_RESULTADOS,
    "A1:D2000",
    Array.from({ length: 2000 }, () => ["", "", "", ""]),
  ).catch(() => {});
  await updateValues(awardId, SHEET_RESULTADOS, `A1:D${matriz.length}`, matriz);

  // Formatação: destaca categoria (negrito, fundo escuro), cabeçalho
  // (negrito, fundo cinza) e vencedor (negrito, fundo dourado).
  try {
    const tabs = await listSheetTabs(awardId);
    const sheetId = tabs.find((t) => t.title === SHEET_RESULTADOS)?.sheetId;
    if (sheetId !== undefined && sheetId >= 0) {
      const repeatCellRequests = (rowIndexes: number[], bg: { red: number; green: number; blue: number }, bold: boolean) =>
        rowIndexes.map((rowIndex) => ({
          repeatCell: {
            range: { sheetId, startRowIndex: rowIndex, endRowIndex: rowIndex + 1, startColumnIndex: 0, endColumnIndex: 4 },
            cell: { userEnteredFormat: { backgroundColor: bg, textFormat: { bold } } },
            fields: "userEnteredFormat(backgroundColor,textFormat)",
          },
        }));

      await spreadsheetBatchUpdate(awardId, [
        ...repeatCellRequests(linhasCategoria, { red: 0.12, green: 0.12, blue: 0.14 }, true),
        ...repeatCellRequests(linhasHeader, { red: 0.85, green: 0.85, blue: 0.85 }, true),
        ...repeatCellRequests(linhasVencedor, { red: 1, green: 0.84, blue: 0.3 }, true),
        {
          updateSheetProperties: {
            properties: { sheetId, gridProperties: { frozenRowCount: 0 } },
            fields: "gridProperties.frozenRowCount",
          },
        },
      ]);
    }
  } catch (err) {
    console.warn("[adminGerarResultadosVmaController] Falha ao formatar a aba (dado já foi gravado):", err);
  }

  const totalAutovotosExcluidos = resultados.reduce((acc, c) => acc + c.autovotosExcluidos, 0);

  return new Response(
    JSON.stringify(
      {
        success: true,
        aba: SHEET_RESULTADOS,
        totalCategorias: resultados.length,
        totalAutovotosExcluidos,
        resultados,
      },
      null,
      2,
    ),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
}

import { googleSheetsService, normalizeComparison } from "../services/googleSheetsService";
import { completarAlbumExistente, type TrackItemPayload } from "./gestaoController";

// Uso pontual (pedido do dono do produto, migração de dados): dado um
// álbum já lançado e uma lista de Códigos únicos (coluna BD de "EDIÇÃO
// CHARTS", planilha edicaoCharts — já registrados nos charts, mas sem
// tópico/linha própria em Musicas ainda, cenário clássico de migração
// incompleta), busca o título real de cada código em EDIÇÃO CHARTS,
// confere se já existe em Musicas (por Código único, coluna Z — nunca por
// texto de título, pra não arriscar falso "já existe" por causa de
// acento/grafia) e cria como FAIXA PENDENTE (mesmo mecanismo de
// completarAlbumExistente/processarFaixasDoAlbum usado quando um jogador
// adiciona faixa nova a um álbum já lançado, com abrirTopico=false) só os
// códigos que ainda não têm linha em Musicas — nunca mexe nos que já têm.
//
// GET /api/empire-play/admin/migrar-faixas-pendentes?albumTopicId=406&jogadorId=1065444507&nomeJogador=Marco&codigos=EMP422,EMP426&confirmar=1
export async function adminMigrarFaixasPendentesController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const albumTopicId = url.searchParams.get("albumTopicId") || "";
  const jogadorId = url.searchParams.get("jogadorId") || "";
  const nomeJogador = url.searchParams.get("nomeJogador") || "";
  const codigosParam = url.searchParams.get("codigos") || "";
  const confirmar = url.searchParams.get("confirmar") === "1";
  const codigosAlvo = codigosParam.split(",").map((c) => c.trim()).filter(Boolean);

  if (!albumTopicId || !jogadorId || !nomeJogador || codigosAlvo.length === 0) {
    return new Response(
      JSON.stringify({
        success: false,
        error: "albumTopicId, jogadorId, nomeJogador e codigos (separados por vírgula) são obrigatórios.",
      }),
      { status: 400, headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  }

  // Acha o álbum em "Albuns" pelo ID do tópico, pra saber o título completo
  // ("Artista - Álbum") — mesma leitura que completarAlbumExistente faz.
  const albunsRows = await googleSheetsService.principal.readValues("Albuns").catch(() => []);
  let albumFullTitle = "";
  for (let i = 1; i < albunsRows.length; i++) {
    if ((albunsRows[i][1] || "").trim() === albumTopicId.trim()) {
      albumFullTitle = (albunsRows[i][6] || "").trim();
      break;
    }
  }
  if (!albumFullTitle) {
    return new Response(JSON.stringify({ success: false, error: `Álbum com ID de tópico "${albumTopicId}" não encontrado em Albuns.` }), {
      status: 404,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  // EDIÇÃO CHARTS (edicaoCharts) — B = título com prefixo, BD (índice 55)
  // = Código único. Lido só até BD, igual outros pontos do código que já
  // mexem nessa aba (ver registrarNaEdicaoChartsSemTrava).
  const edicaoChartsRows = await googleSheetsService.edicaoCharts
    .readValues("EDIÇÃO CHARTS", "A2:BD20000")
    .catch(() => []);
  const tituloPorCodigo = new Map<string, string>();
  for (const row of edicaoChartsRows) {
    const codigo = normalizeComparison(row[55] || ""); // BD = índice 55 (A=0,...,Z=25,AA=26,...,BD=55)
    const titulo = (row[1] || "").trim(); // B
    if (codigo && titulo) tituloPorCodigo.set(codigo, titulo);
  }

  // Musicas (principal) — Z (índice 25) = Código único.
  const musicasRows = await googleSheetsService.principal.readValues("Musicas").catch(() => []);
  const codigosExistentesEmMusicas = new Set(
    musicasRows.slice(1).map((r) => normalizeComparison(r[25] || "")).filter(Boolean),
  );

  const jaExistem: { codigo: string; titulo: string }[] = [];
  const faltando: { codigo: string; titulo: string }[] = [];
  const naoEncontradosEmEdicaoCharts: string[] = [];

  for (const codigo of codigosAlvo) {
    const normCodigo = normalizeComparison(codigo);
    const titulo = tituloPorCodigo.get(normCodigo);
    if (!titulo) {
      naoEncontradosEmEdicaoCharts.push(codigo);
      continue;
    }
    if (codigosExistentesEmMusicas.has(normCodigo)) {
      jaExistem.push({ codigo, titulo });
    } else {
      faltando.push({ codigo, titulo });
    }
  }

  let resultadoCriacao: unknown = null;
  if (confirmar && faltando.length > 0) {
    const novasFaixas: TrackItemPayload[] = faltando.map((f, i) => ({
      num: i + 1,
      inedita: true,
      titulo: f.titulo,
      abrirTopico: false, // Pendente = "Sim" — mesma lógica de lançar o single depois.
    }));
    resultadoCriacao = await completarAlbumExistente({
      albumTopicId,
      novasFaixas,
      nomeJogador,
      jogadorId,
    });
  }

  return new Response(
    JSON.stringify(
      {
        success: true,
        confirmar,
        albumFullTitle,
        jaExistem,
        faltando,
        naoEncontradosEmEdicaoCharts,
        resultadoCriacao,
      },
      null,
      2,
    ),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
}

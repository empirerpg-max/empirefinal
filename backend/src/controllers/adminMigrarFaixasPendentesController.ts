import { googleSheetsService, normalizeComparison } from "../services/googleSheetsService";

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

  // EDIÇÃO CHARTS (edicaoCharts) — B título com prefixo, C tipo single, D
  // tipo música, E álbum, F weeks, BD (índice 55) Código único. Lido só até
  // BD, igual outros pontos do código que já mexem nessa aba (ver
  // registrarNaEdicaoChartsSemTrava).
  const edicaoChartsRows = await googleSheetsService.edicaoCharts
    .readValues("EDIÇÃO CHARTS", "A2:BD20000")
    .catch(() => []);
  const infoPorCodigo = new Map<
    string,
    { titulo: string; tipoSingle: string; tipoMusica: string; album: string; weeks: string }
  >();
  for (const row of edicaoChartsRows) {
    const codigo = normalizeComparison(row[55] || ""); // BD = índice 55 (A=0,...,Z=25,AA=26,...,BD=55)
    const titulo = (row[1] || "").trim(); // B
    if (codigo && titulo) {
      infoPorCodigo.set(codigo, {
        titulo,
        tipoSingle: (row[2] || "").trim(),
        tipoMusica: (row[3] || "").trim(),
        album: (row[4] || "").trim(),
        weeks: (row[5] || "").trim(),
      });
    }
  }

  // Musicas (principal) — Z (índice 25) = Código único.
  const musicasRows = await googleSheetsService.principal.readValues("Musicas").catch(() => []);
  const codigosExistentesEmMusicas = new Set(
    musicasRows.slice(1).map((r) => normalizeComparison(r[25] || "")).filter(Boolean),
  );

  const jaExistem: { codigo: string; titulo: string }[] = [];
  const faltando: { codigo: string; titulo: string; tipoSingle: string; tipoMusica: string; weeks: string }[] = [];
  const naoEncontradosEmEdicaoCharts: string[] = [];

  for (const codigo of codigosAlvo) {
    const normCodigo = normalizeComparison(codigo);
    const info = infoPorCodigo.get(normCodigo);
    if (!info) {
      naoEncontradosEmEdicaoCharts.push(codigo);
      continue;
    }
    if (codigosExistentesEmMusicas.has(normCodigo)) {
      jaExistem.push({ codigo, titulo: info.titulo });
    } else {
      faltando.push({ codigo, titulo: info.titulo, tipoSingle: info.tipoSingle, tipoMusica: info.tipoMusica, weeks: info.weeks });
    }
  }

  const artistaAlbum = albumFullTitle.includes(" - ")
    ? albumFullTitle.slice(0, albumFullTitle.indexOf(" - ")).trim()
    : albumFullTitle;
  const dataFormatada = new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });

  const criadas: { codigo: string; titulo: string; linha: number }[] = [];
  if (confirmar && faltando.length > 0) {
    // Escreve direto em Musicas com updateValues num range A{linha}:Y{linha}
    // EXPLÍCITO — nunca appendRow/:append nativo aqui (causa raiz real
    // confirmada nesta mesma migração: a heurística de "próxima linha
    // livre" do Sheets erra em abas esparsas e escreve os dados fora de
    // posição — ver comentário em appendRowMusicasComCursor, gestaoController.ts).
    // EDIÇÃO CHARTS já tem a linha de cada código (por isso "faltando" só
    // considera Musicas) — não mexe nela de novo, só copia o Código único
    // já existente pra Z.
    let proximaLinha = musicasRows.length + 1;
    for (let i = 0; i < faltando.length; i++) {
      const f = faltando[i];
      const linha = proximaLinha;
      const row = [
        dataFormatada, // A
        "", // B - ID do tópico (pendente, sem tópico ainda)
        "", // C - ID do arquivo
        "", // D - Capa
        "", // E - Letra
        "", // F - Comentários para
        jogadorId, // G - ID do Criador
        f.titulo, // H - Nome da música
        f.tipoSingle || "TRACKLIST ALBUM", // I
        f.tipoMusica || "SOLO", // J
        albumFullTitle, // K - ALBUM
        f.weeks || "", // L - WEEKS
        "", // M - WEEKS VIDEO
        artistaAlbum, // N - ACT PRINCIPAL
        "", "", "", "", "", // O-S - ARTISTA 2-6
        "", // T - GÊNERO
        String(i + 1), // U - Ordem
        "", // V - Metacritic por jogador
        "", // W - Média Metacritic
        "Sim", // X - Pendente?
      ];
      await googleSheetsService.principal.updateValues("Musicas", `A${linha}:Y${linha}`, [row]);
      await googleSheetsService.principal.updateValues("Musicas", `Z${linha}`, [[f.codigo]]);
      criadas.push({ codigo: f.codigo, titulo: f.titulo, linha });
      proximaLinha += 1;
    }
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
        criadas,
      },
      null,
      2,
    ),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
}

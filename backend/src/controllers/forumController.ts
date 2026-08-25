import {
  googleSheetsService,
  normalizeComparison,
  normalizeHeader,
  normalizeText,
  dedupeHeaders,
} from "../services/googleSheetsService";
import { registrarAuditLog } from "./registroLogController";
import { somarPrestigio } from "../services/prestigioService";

const USUARIOS_SHEET = "Usuários";

/**
 * Resolve o nome "oficial" do jogador — coluna A ("Nome") da aba Usuários,
 * o nome padrão de registro — a partir do ID (jogadorId) ou, se não achar,
 * do login (Usuário, coluna C). Usado só pra gravar comentários/audit log
 * com o nome correto; nunca falha o comentário se a busca der errado, cai
 * pro nome que o cliente mandou.
 */
async function resolveNomeOficial(jogadorId: string, fallback: string): Promise<string> {
  try {
    const rows = await googleSheetsService.usuarios.readValues(USUARIOS_SHEET);
    if (!rows || rows.length < 2) return fallback;
    const headers = dedupeHeaders(
      USUARIOS_SHEET,
      rows[0].map((h, i) => normalizeHeader(h) || `coluna_${i + 1}`),
    );
    const nomeCol = headers.indexOf("nome");
    const idCol = headers.indexOf("id");
    const usuarioCol = headers.indexOf("usuario");
    if (nomeCol === -1) return fallback;

    const normId = normalizeComparison(jogadorId);
    const normFallback = normalizeComparison(fallback);
    const match = rows.slice(1).find((r) => {
      const matchId = !!normId && idCol !== -1 && normalizeComparison(r[idCol]) === normId;
      const matchUsuario =
        !matchId &&
        !!normFallback &&
        usuarioCol !== -1 &&
        normalizeComparison(r[usuarioCol]) === normFallback;
      return matchId || matchUsuario;
    });
    const nome = match ? normalizeText(match[nomeCol]) : "";
    return nome || fallback;
  } catch (err) {
    console.warn("[forumController] Falha ao resolver nome oficial:", err);
    return fallback;
  }
}

/**
 * Resolve o título "canônico" de uma música a partir do Código único —
 * fazendo o caminho inverso do que EDIÇÃO CHARTS!BD faz (título → código).
 * É essa busca que faz "conta pra outra música" (opção c na criação) e
 * vídeos vinculados a uma música (musicaVinculada) carregarem o título
 * exato da música referenciada no REGISTRO, em vez do título da própria
 * linha — sem depender de comparação de texto, que quebra com qualquer
 * diferença mínima (acento, espaço, feat. adicionado depois etc.).
 */
async function resolverTituloPorCodigoUnico(codigoUnico: string): Promise<string | null> {
  if (!codigoUnico) return null;
  try {
    const rows = await googleSheetsService.edicaoCharts.readValues("EDIÇÃO CHARTS");
    const alvo = normalizeComparison(codigoUnico);
    const linha = rows.slice(1).find((r) => normalizeComparison(r[55]) === alvo); // BD
    const titulo = linha ? normalizeText(linha[1]) : ""; // B
    return titulo || null;
  } catch (err) {
    console.warn("[forumController] Falha ao resolver título por Código único:", err);
    return null;
  }
}

export interface CreateCommentBody {
  tipoMedia: "musica" | "music-video" | "video" | "album";
  tituloMedia: string;
  topicId?: string;
  jogadorId?: string;
  nomeJogador: string;
  comentario: string;
  intervalo: string; // "45 - 60" | "61 - 75" | "76 - 90" | "91 - 100"
}

/**
 * Monta a linha a ser gravada na aba de comentários certa — cada aba tem um
 * schema de colunas diferente (confirmado no documento oficial do Empire
 * Play), então NÃO dá pra usar a mesma ordem [data, titulo, jogador,
 * comentario, nota] para todas, como o código antigo fazia (isso corrompia
 * a planilha real a cada comentário).
 */
function buildCommentRow(
  tipoMedia: CreateCommentBody["tipoMedia"],
  params: { topicId: string; jogadorId: string; playerClean: string; comentario: string; nowStr: string },
): string[] {
  const { topicId, jogadorId, playerClean, comentario, nowStr } = params;

  if (tipoMedia === "musica") {
    // Comentarios_Musicas: ID do tópico, ID do jogador, Nome do jogador, Comentário
    return [topicId, jogadorId, playerClean, comentario];
  }
  // Comentarios_MV (vídeos — a antiga Comentarios_Videos não existe mais,
  // Vídeos e Music Videos foram consolidados) / Comentarios_Albuns:
  // ID do tópico, ID do jogador, Nome do jogador, Comentário, Data
  return [topicId, jogadorId, playerClean, comentario, nowStr];
}

export function rollRandomScore(intervaloStr: string): number {
  const match = (intervaloStr || "").match(/(\d+)\s*-\s*(\d+)/);
  let min = 45;
  let max = 100;
  if (match) {
    min = parseInt(match[1], 10);
    max = parseInt(match[2], 10);
  }
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function colIndexToA1Letter(colIndex: number): string {
  let temp = colIndex;
  let letter = "";
  while (temp >= 0) {
    letter = String.fromCharCode((temp % 26) + 65) + letter;
    temp = Math.floor(temp / 26) - 1;
  }
  return letter;
}

export function calculateAverageFromRatings(ratingsStr: string): number {
  if (!ratingsStr) return 0;
  const numbers = ratingsStr.match(/\d+/g);
  if (!numbers || numbers.length === 0) return 0;
  const sum = numbers.reduce((acc, val) => acc + parseInt(val, 10), 0);
  return Math.round(sum / numbers.length);
}

export async function createCommentController(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as CreateCommentBody;

    const { tipoMedia, tituloMedia, topicId, jogadorId, nomeJogador, comentario, intervalo } = body;

    if (!tipoMedia || !tituloMedia || !nomeJogador || !comentario) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Campos obrigatórios ausentes (tipoMedia, tituloMedia, nomeJogador, comentario).",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    const score = rollRandomScore(intervalo);
    const titleClean = tituloMedia.trim();
    const topicIdClean = (topicId || "").trim();
    const jogadorIdClean = (jogadorId || "").trim();
    // Comentário/audit log sempre gravam o nome "oficial" (coluna A da aba
    // Usuários), nunca o nome de login (coluna C) — mesmo que o cliente
    // mande outro nome, ele só serve de fallback caso a busca falhe.
    const playerClean = await resolveNomeOficial(jogadorIdClean, nomeJogador.trim());

    // Configuração de abas e colunas conforme tipo da mídia
    let targetSheet = "Musicas";
    let commentSheet = "Comentarios_Musicas";
    let colTopicIdIndex = 1; // Coluna B — "ID do tópico"
    let colTituloIndex = 7; // Coluna H — "Nome da música"
    let colRatingsIndex = 21; // Coluna V (0-based 21)
    let colAvgIndex = 22; // Coluna W (0-based 22)
    let colCodigoIndex = 25; // Coluna Z — "Código único" (chave pra REGISTRO)

    if (tipoMedia === "album") {
      targetSheet = "Albuns";
      commentSheet = "Comentarios_Albuns";
      colTopicIdIndex = 1; // Coluna B — "ID do tópico"
      colTituloIndex = 6; // Coluna G — "Novo Nome"
      colRatingsIndex = 7; // Coluna H
      colAvgIndex = 8; // Coluna I
      colCodigoIndex = 11; // Coluna L — "Código único"
    } else if (tipoMedia === "video" || tipoMedia === "music-video") {
      // "Videos"/"Comentarios_Videos" não existem mais — Vídeos e Music
      // Videos foram consolidados em "Music Videos"/"Comentarios_MV". A
      // coluna B dessa aba é o TÍTULO do tópico, não o ID — o ID único de
      // verdade é a coluna F ("message_thread_id"). Colunas de nota: N =
      // Likes por jogador (13), O = Média Likes (14).
      targetSheet = "Music Videos";
      commentSheet = "Comentarios_MV";
      colTopicIdIndex = 5; // Coluna F — "message_thread_id"
      colTituloIndex = 1; // Coluna B — Título do tópico
      colRatingsIndex = 13; // Coluna N (0-based 13)
      colAvgIndex = 14; // Coluna O (0-based 14)
      colCodigoIndex = 20; // Coluna U — "Código único" (mesmos códigos de EDIÇÃO CHARTS)
    }

    // Título "oficial" pro Audit Log — resolvido pelo ID único (topicId) da
    // linha certa na planilha, não pelo título que o cliente mandou. O
    // cliente pode estar com uma versão desatualizada em cache (ex: título
    // mudou depois de um feat. ser adicionado), e nesse caso o registro em
    // REGISTRO saía com o título errado. Só cai pro título do cliente se o
    // topicId não bater com nenhuma linha (nunca bloqueia o registro).
    let tituloOficial = titleClean;
    // Código único (Z/L/U conforme a aba) — chave real pro casamento com
    // EDIÇÃO CHARTS/EDIÇÃO CHARTS ÁLBUMS em registrarAuditLog. Vazio quando a
    // linha ainda não tem código preenchido (registrarAuditLog cai pro
    // fallback por título nesse caso).
    let codigoUnico = "";

    // 1. Atualizar nota/likes e média na planilha principal — isolado num
    // try/catch pra uma falha aqui (ex: título sem match nenhum) nunca
    // impedir os passos 2 e 3 (salvar o comentário e o audit log).
    try {
      const rows = await googleSheetsService.principal.readValues(targetSheet);

      if (rows && rows.length > 0) {
        // Busca pela coluna de ID do tópico certa pra essa aba (ver acima —
        // Music Videos usa uma posição diferente de Musicas/Albuns). Só cai
        // pra busca por título (substring, menos confiável) se o topicId não
        // vier.
        let foundRowIndex = -1;

        if (topicIdClean) {
          const topicNorm = normalizeComparison(topicIdClean);
          for (let i = 1; i < rows.length; i++) {
            if (normalizeComparison(rows[i][colTopicIdIndex] || "") === topicNorm) {
              foundRowIndex = i + 1; // A1 row number (1-based)
              break;
            }
          }
        }

        if (foundRowIndex === -1) {
          const titleNorm = normalizeComparison(titleClean);
          for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            const rowText = row.join(" ");
            if (normalizeComparison(rowText).includes(titleNorm)) {
              foundRowIndex = i + 1; // A1 row number (1-based)
              break;
            }
          }
        }

        if (foundRowIndex > 0) {
          const rowData = rows[foundRowIndex - 1] || [];
          const tituloDaLinha = normalizeText(rowData[colTituloIndex]);
          if (tituloDaLinha) tituloOficial = tituloDaLinha;
          codigoUnico = normalizeText(rowData[colCodigoIndex]);

          // Se essa linha carrega o Código único de OUTRA música (ex: um
          // vídeo vinculado, ou uma faixa criada com "conta pra uma música
          // já lançada"), o título de verdade pro REGISTRO é o da música
          // dona desse código, não o título da própria linha (topic/vídeo).
          if (tipoMedia !== "album" && codigoUnico) {
            const tituloReal = await resolverTituloPorCodigoUnico(codigoUnico);
            if (tituloReal) tituloOficial = tituloReal;
          }

          const currentRatings = rowData[colRatingsIndex] || "";

          const updatedRatings = currentRatings.trim()
            ? `${currentRatings.trim()}, ${playerClean}: ${score}`
            : `${playerClean}: ${score}`;

          const newAvg = calculateAverageFromRatings(updatedRatings);

          const ratingColLetter = colIndexToA1Letter(colRatingsIndex);
          const avgColLetter = colIndexToA1Letter(colAvgIndex);

          // Atualiza a coluna de ratings por jogador e coluna de média
          await googleSheetsService.principal.updateValues(
            targetSheet,
            `${ratingColLetter}${foundRowIndex}`,
            [[updatedRatings]],
          );

          await googleSheetsService.principal.updateValues(
            targetSheet,
            `${avgColLetter}${foundRowIndex}`,
            [[String(newAvg)]],
          );
        }
      }
    } catch (err) {
      console.warn("[ForumController] Erro ao atualizar nota/média:", err);
    }

    // 2. Salvar comentário na aba de comentários correspondente
    const nowStr = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
    // Linha real onde o comentário caiu — permite reagir com emoji
    // imediatamente após publicar, direto no fluxo do comentário, sem
    // precisar reler a aba pra descobrir a linha depois.
    let newRowIndex: number | null = null;
    try {
      newRowIndex = await googleSheetsService.principal.appendRow(
        commentSheet,
        buildCommentRow(tipoMedia, {
          topicId: topicIdClean,
          jogadorId: jogadorIdClean,
          playerClean,
          comentario: comentario.trim(),
          nowStr,
        }),
      );
    } catch (err) {
      console.warn(`[ForumController] Não foi possível salvar em ${commentSheet}:`, err);
    }

    // 3. Registrar Audit Log na Planilha REGISTRO (1wNbtP78MrtrOc2Jb1ejXcHVjqndR2Vm4-3EIVqa8aOg)
    await registrarAuditLog({
      nomeJogador: playerClean,
      titulo: tituloOficial,
      tipo:
        tipoMedia === "album"
          ? "COMENTÁRIOS (TODOS OS TIPOS DE ÁLBUM)"
          : "COMENTÁRIOS (SINGLES, VÍDEOS, MÚSICAS)",
      isAlbum: tipoMedia === "album",
      codigoUnico,
    });

    await somarPrestigio({ telegramId: jogadorIdClean, usuario: playerClean }, "comentario").catch(() => {});

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          tipoMedia,
          tituloMedia: titleClean,
          nomeJogador: playerClean,
          notaCalculada: score,
          rowIndex: newRowIndex,
          sheetComments: newRowIndex ? commentSheet : null,
          mensagem: "Comentário e avaliação processados com sucesso!",
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (error: any) {
    console.error("[createCommentController] Erro:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || "Erro interno ao processar comentário.",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}

export async function getCommentsController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const tituloParam = url.searchParams.get("titulo") || "";
  const topicIdParam = url.searchParams.get("topicId") || "";

  try {
    // "Comentarios_Videos" não existe mais — Vídeos e Music Videos foram
    // consolidados em "Comentarios_MV".
    const [musicaComments, mvComments, albumComments] = await Promise.all([
      googleSheetsService.principal.readValues("Comentarios_Musicas").catch(() => []),
      googleSheetsService.principal.readValues("Comentarios_MV").catch(() => []),
      googleSheetsService.principal.readValues("Comentarios_Albuns").catch(() => []),
    ]);

    // Cada aba tem seu próprio schema de colunas (ver buildCommentRow acima) —
    // o parse precisa respeitar isso, não dá pra usar posições genéricas.
    const formatMusicaOrAlbumStyle = (rows: string[][], tipo: string, hasData: boolean) => {
      if (!rows || rows.length <= 1) return [];
      return rows.slice(1).map((r, idx) => ({
        id: `${tipo}_${idx + 1}`,
        tipo,
        topicId: r[0] || "",
        jogadorId: r[1] || "",
        jogador: r[2] || "",
        comentario: r[3] || "",
        data: hasData ? r[4] || "" : "",
      }));
    };

    let allComments = [
      ...formatMusicaOrAlbumStyle(musicaComments, "musica", false),
      ...formatMusicaOrAlbumStyle(mvComments, "video", true),
      ...formatMusicaOrAlbumStyle(albumComments, "album", true),
    ];

    if (topicIdParam) {
      const norm = normalizeComparison(topicIdParam);
      allComments = allComments.filter((c) => normalizeComparison(c.topicId) === norm);
    } else if (tituloParam) {
      const norm = normalizeComparison(tituloParam);
      allComments = allComments.filter((c) => normalizeComparison(c.topicId).includes(norm));
    }

    return new Response(
      JSON.stringify({
        success: true,
        data: allComments,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ success: false, error: err.message || "Erro ao buscar comentários." }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}

export interface EditCommentBody {
  sheetComments: string;
  rowIndex: number;
  jogadorId: string;
  novoTexto: string;
}

// Coluna do texto do comentário — igual nas três abas (ver buildCommentRow
// acima: A-D pra Comentarios_Musicas, A-E pras outras, mas o comentário
// sempre cai na D).
const COMMENT_TEXT_COLUMN: Record<string, string> = {
  Comentarios_Musicas: "D",
  Comentarios_MV: "D",
  Comentarios_Albuns: "D",
};

/**
 * POST /api/forum/comment-edit
 * Só quem escreveu o comentário (coluna B — ID do jogador) pode editá-lo.
 */
export async function editCommentController(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as EditCommentBody;
    const { sheetComments, rowIndex, jogadorId, novoTexto } = body;

    const col = COMMENT_TEXT_COLUMN[sheetComments];
    if (!col || !rowIndex || rowIndex < 2 || !jogadorId || !novoTexto?.trim()) {
      return new Response(
        JSON.stringify({ success: false, error: "Parâmetros inválidos pra editar este comentário." }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    const ownerRows = await googleSheetsService.principal.readValues(
      sheetComments,
      `B${rowIndex}:B${rowIndex}`,
    );
    const ownerId = (ownerRows?.[0]?.[0] || "").trim();
    if (!ownerId || ownerId !== jogadorId.trim()) {
      return new Response(
        JSON.stringify({ success: false, error: "Você só pode editar seus próprios comentários." }),
        { status: 403, headers: { "Content-Type": "application/json" } },
      );
    }

    await googleSheetsService.principal.updateValues(sheetComments, `${col}${rowIndex}`, [
      [novoTexto.trim()],
    ]);

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("[editCommentController] Erro:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message || "Erro ao editar comentário." }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}

export interface ToggleReactionBody {
  // Nome exato da aba de comentários e a linha real nela — ambos vêm do
  // próprio comentário retornado por getEmpirePlayForumTopicController
  // (campos rowIndex/sheetComments), nunca inventados pelo cliente.
  sheetComments: string;
  rowIndex: number;
  emoji: string;
  jogadorId: string;
}

// Colunas de reação por aba — logo após as colunas já mapeadas de cada uma
// (Comentarios_Musicas tem A-D; Comentarios_MV e Comentarios_Albuns têm A-E).
const REACTION_COLUMN: Record<string, string> = {
  Comentarios_Musicas: "E",
  Comentarios_MV: "F",
  Comentarios_Albuns: "F",
};

/**
 * POST /api/forum/comment-reaction
 * Alterna (adiciona/remove) a reação de um emoji num comentário. Guarda um
 * JSON { emoji: [jogadorId, ...] } na coluna de reação da aba de
 * comentários, criando o cabeçalho "Reações" na primeira vez que a coluna é
 * usada (nenhuma aba de comentários tinha essa coluna originalmente).
 */
export async function toggleCommentReactionController(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as ToggleReactionBody;
    const { sheetComments, rowIndex, emoji, jogadorId } = body;

    const col = REACTION_COLUMN[sheetComments];
    if (!col || !rowIndex || rowIndex < 2 || !emoji || !jogadorId) {
      return new Response(
        JSON.stringify({ success: false, error: "Parâmetros inválidos pra reagir a este comentário." }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    // Garante o cabeçalho da coluna de reação (self-healing — a coluna não
    // existia antes desta feature).
    const headerRow = await googleSheetsService.principal.readValues(sheetComments, "1:1");
    const currentHeader = (headerRow?.[0]?.[col.charCodeAt(0) - 65] || "").trim();
    if (normalizeComparison(currentHeader) !== "reacoes") {
      await googleSheetsService.principal.updateValues(sheetComments, `${col}1`, [["Reações"]]);
    }

    const cellRows = await googleSheetsService.principal.readValues(
      sheetComments,
      `${col}${rowIndex}:${col}${rowIndex}`,
    );
    const currentRaw = cellRows?.[0]?.[0] || "";

    let reactionsMap: Record<string, string[]> = {};
    if (currentRaw) {
      try {
        const parsed = JSON.parse(currentRaw);
        if (parsed && typeof parsed === "object") reactionsMap = parsed;
      } catch {
        // JSON inválido/legado — trata como se não houvesse reações ainda.
      }
    }

    const current = reactionsMap[emoji] || [];
    const alreadyReacted = current.includes(jogadorId);
    reactionsMap[emoji] = alreadyReacted
      ? current.filter((id) => id !== jogadorId)
      : [...current, jogadorId];
    if (reactionsMap[emoji].length === 0) delete reactionsMap[emoji];

    await googleSheetsService.principal.updateValues(sheetComments, `${col}${rowIndex}`, [
      [JSON.stringify(reactionsMap)],
    ]);

    if (!alreadyReacted) {
      await somarPrestigio({ telegramId: jogadorId }, "curtida").catch(() => {});
    }

    const reactions: Record<string, number> = {};
    Object.entries(reactionsMap).forEach(([e, ids]) => {
      reactions[e] = ids.length;
    });

    return new Response(
      JSON.stringify({ success: true, data: { reactions, reactedBy: reactionsMap } }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (error: any) {
    console.error("[toggleCommentReactionController] Erro:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message || "Erro ao reagir ao comentário." }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}

/**
 * GET /api/forum/atividade-recente
 * Últimos comentários feitos no Fórum (música/vídeo/álbum), pro ticker de
 * "fulano comentou em tal coisa" na home. Lê direto de Comentarios_Musicas/
 * Comentarios_MV/Comentarios_Albuns (nunca são resetadas) em vez de REGISTRO
 * (aba zerada toda semana pro recálculo dos charts — não serviria como
 * histórico). As abas de comentário só guardam o ID do tópico, então
 * resolve o título de volta consultando a aba de catálogo correspondente
 * (mesmas colunas já usadas em createCommentController).
 */
export async function getAtividadeRecenteController(): Promise<Response> {
  try {
    const [musicaComments, mvComments, albumComments, musicasRows, mvRows, albunsRows] = await Promise.all([
      googleSheetsService.principal.readValues("Comentarios_Musicas").catch(() => []),
      googleSheetsService.principal.readValues("Comentarios_MV").catch(() => []),
      googleSheetsService.principal.readValues("Comentarios_Albuns").catch(() => []),
      googleSheetsService.principal.readValues("Musicas").catch(() => []),
      googleSheetsService.principal.readValues("Music Videos").catch(() => []),
      googleSheetsService.principal.readValues("Albuns").catch(() => []),
    ]);

    // topicId → título, uma vez por catálogo (evita varrer a aba de novo
    // pra cada comentário).
    const mapaTitulos = (rows: string[][], colId: number, colTitulo: number) => {
      const mapa = new Map<string, string>();
      for (let i = 1; i < rows.length; i++) {
        const id = normalizeComparison(rows[i]?.[colId]);
        const titulo = normalizeText(rows[i]?.[colTitulo]);
        if (id && titulo) mapa.set(id, titulo);
      }
      return mapa;
    };
    const titulosMusicas = mapaTitulos(musicasRows, 1, 7); // B ID do tópico, H Nome
    const titulosVideos = mapaTitulos(mvRows, 5, 1); // F message_thread_id, B Título
    const titulosAlbuns = mapaTitulos(albunsRows, 1, 6); // B ID do tópico, G Novo Nome

    const ultimos = (rows: string[][], tipo: "musica" | "video" | "album", mapa: Map<string, string>, n: number) => {
      if (!rows || rows.length <= 1) return [];
      return rows
        .slice(1)
        .slice(-n)
        .reverse()
        .map((r) => ({
          jogador: normalizeText(r[2]),
          titulo: mapa.get(normalizeComparison(r[0])) || "",
          tipo,
        }))
        .filter((c) => c.jogador && c.titulo);
    };

    const atividades = [
      ...ultimos(musicaComments, "musica", titulosMusicas, 8),
      ...ultimos(mvComments, "video", titulosVideos, 8),
      ...ultimos(albumComments, "album", titulosAlbuns, 8),
    ].slice(0, 20);

    return new Response(JSON.stringify({ success: true, data: atividades }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("[getAtividadeRecenteController] Erro:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message || "Erro ao buscar atividade recente." }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}

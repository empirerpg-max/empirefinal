import { sheetsService } from "../services/sheetsService";
import { normalizeComparison, normalizeText } from "../services/googleSheetsService";

// Varredura GERAL (não é rota de uso recorrente) de comentários órfãos —
// linhas em qualquer uma das abas de comentário cujo "ID do tópico" não
// bate com o ID real de NENHUMA linha de mídia hoje. É o mesmo bug de raiz
// já corrigido em createCommentController (forumController.ts): antes da
// correção, um cliente com ID de tópico desatualizado em cache (fallback
// por posição de linha, tipo "videos_idx215") gravava o comentário E a
// notificação com esse ID errado — ficando órfão pra sempre assim que a
// posição da linha mudasse. Essa rota conserta os casos que já existiam
// ANTES da correção de código, pra qualquer música/vídeo/álbum, não só um
// caso específico.
//
// Como não dá pra recuperar o título pretendido só pela linha de
// comentário (não guarda título), cruza com a aba "Notificacoes" — que
// guarda {autor, título da mídia, trecho do comentário, ID do tópico
// usado} no momento exato em que aquele comentário foi postado. Casa por
// autor + trecho do texto (não só pelo ID velho, que pode colidir com
// outra linha no futuro), acha o título pretendido, e a partir do título
// acha o ID real e atual daquela mídia — nunca inventa/adivinha nada: se
// não achar um cruzamento seguro, deixa a linha como está e reporta.
const MEDIA_CONFIG: {
  tipo: string;
  mediaSheet: string;
  commentSheet: string;
  colTopicIdIndex: number;
  colTituloIndex: number;
}[] = [
  { tipo: "musica", mediaSheet: "Musicas", commentSheet: "Comentarios_Musicas", colTopicIdIndex: 1, colTituloIndex: 7 },
  { tipo: "video", mediaSheet: "Music Videos", commentSheet: "Comentarios_MV", colTopicIdIndex: 5, colTituloIndex: 1 },
  { tipo: "album", mediaSheet: "Albuns", commentSheet: "Comentarios_Albuns", colTopicIdIndex: 1, colTituloIndex: 6 },
];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function colLetter(zeroBasedIndex: number): string {
  return String.fromCharCode(65 + zeroBasedIndex);
}

// A aba "Music Videos" guarda o título com sufixo "(Official Music
// Video)"/"(Lyric Video)"/etc — a notificação guarda o título "limpo",
// sem sufixo. Sem tirar isso, um vídeo com sufixo nunca casava com o
// título recuperado da notificação, mesmo sendo a mídia certa.
function tituloBase(titulo: string): string {
  return normalizeComparison(titulo).replace(/\s*\([^)]*\)\s*$/, "").trim();
}

interface NotificacaoRow {
  autorNome: string;
  tituloMedia: string;
  topicIdUsado: string;
  trechoComentario: string;
}

/**
 * GET /api/empire-play/admin/fix-orphan-comments
 * Idempotente e seguro: só escreve numa linha quando acha, com segurança
 * (autor + trecho do comentário batendo), qual era o título pretendido —
 * e só se esse título hoje tiver uma linha de mídia com ID de tópico real.
 * Rodar de novo depois de corrigido não faz mais nada com essas linhas.
 */
export async function adminFixOrphanCommentsController(): Promise<Response> {
  const notifRows = await sheetsService.readValues("Notificacoes").catch(() => []);
  const notifHeader = notifRows[0] || [];
  // "ID do autor" e "Nome do autor" existem as duas — sem o "nome" aqui,
  // findIndex batia na primeira (o ID numérico) e nenhum comentário nunca
  // casava com nenhuma notificação (autorNome virava um número).
  const colNotifAutor = notifHeader.findIndex(
    (h) => normalizeComparison(h).includes("nome") && normalizeComparison(h).includes("autor"),
  );
  const colNotifTitulo = notifHeader.findIndex((h) => normalizeComparison(h).includes("titulo"));
  const colNotifTopico = notifHeader.findIndex((h) => normalizeComparison(h).includes("topico"));
  const colNotifComentario = notifHeader.findIndex((h) => normalizeComparison(h).includes("comentario"));

  const notificacoes: NotificacaoRow[] = (notifRows.length > 1 ? notifRows.slice(1) : [])
    .filter((r) => r.some((c) => normalizeText(c)))
    .map((r) => ({
      autorNome: normalizeText(r[colNotifAutor] || ""),
      tituloMedia: normalizeText(r[colNotifTitulo] || ""),
      topicIdUsado: (r[colNotifTopico] || "").trim(),
      trechoComentario: normalizeText(r[colNotifComentario] || ""),
    }));

  const resultadosPorAba: any[] = [];
  let totalCorrigidos = 0;
  let totalNaoRecuperaveis = 0;

  for (const cfg of MEDIA_CONFIG) {
    const mediaRows = await sheetsService.readValues(cfg.mediaSheet).catch(() => []);
    const validTopicIds = new Map<string, { titulo: string; idReal: string }>();
    for (let i = 1; i < mediaRows.length; i++) {
      const idReal = (mediaRows[i][cfg.colTopicIdIndex] || "").trim();
      if (!idReal) continue;
      const titulo = normalizeText(mediaRows[i][cfg.colTituloIndex] || "");
      validTopicIds.set(normalizeComparison(idReal), { titulo, idReal });
    }
    // Índice por título normalizado, pra achar o ID real a partir do
    // título recuperado via Notificacoes. Guarda tanto o título exato
    // quanto a versão sem sufixo "(Official Music Video)"/"(Lyric
    // Video)"/etc — sem duplicar a chave já existente (prefere o primeiro
    // achado quando duas linhas, ex: MV oficial + lyric video, colapsam pro
    // mesmo título-base).
    const idPorTitulo = new Map<string, string>();
    const idPorTituloBase = new Map<string, string>();
    for (const { titulo, idReal } of validTopicIds.values()) {
      if (!titulo) continue;
      const chaveExata = normalizeComparison(titulo);
      if (!idPorTitulo.has(chaveExata)) idPorTitulo.set(chaveExata, idReal);
      const chaveBase = tituloBase(titulo);
      if (chaveBase && !idPorTituloBase.has(chaveBase)) idPorTituloBase.set(chaveBase, idReal);
    }

    const commentRows = await sheetsService.readValues(cfg.commentSheet).catch(() => []);
    const commentHeader = commentRows[0] || [];
    const colTopico = commentHeader.findIndex((h) => normalizeComparison(h).includes("topico"));
    const colJogador = commentHeader.findIndex(
      (h) => normalizeComparison(h).includes("nome") && normalizeComparison(h).includes("jogador"),
    );
    const colComentario = commentHeader.findIndex((h) => normalizeComparison(h).includes("comentario"));

    const detalhes: any[] = [];
    if (colTopico < 0) {
      resultadosPorAba.push({ aba: cfg.commentSheet, erro: "Coluna 'ID do tópico' não encontrada." });
      continue;
    }

    for (let i = 1; i < commentRows.length; i++) {
      const row = commentRows[i];
      if (!row.some((c) => normalizeText(c))) continue;
      const topicoVal = (row[colTopico] || "").trim();
      if (!topicoVal) continue;
      if (validTopicIds.has(normalizeComparison(topicoVal))) continue; // já casa com uma mídia real

      // Órfão — tenta recuperar via Notificacoes (autor + trecho do texto).
      const jogadorVal = normalizeText(row[colJogador] || "");
      const comentarioVal = normalizeText(row[colComentario] || "");
      const comentarioNorm = normalizeComparison(comentarioVal);
      const candidato = notificacoes.find((n) => {
        if (n.autorNome && jogadorVal && normalizeComparison(n.autorNome) !== normalizeComparison(jogadorVal)) {
          return false;
        }
        if (!n.trechoComentario || !comentarioVal) return false;
        const trecho = normalizeComparison(n.trechoComentario.replace(/…$/, ""));
        return comentarioNorm.includes(trecho) || trecho.includes(comentarioNorm);
      });

      if (!candidato) {
        totalNaoRecuperaveis++;
        detalhes.push({ linha: i + 1, topicoAntigo: topicoVal, ok: false, motivo: "Sem match em Notificacoes." });
        continue;
      }

      const idRealNovo =
        idPorTitulo.get(normalizeComparison(candidato.tituloMedia)) ||
        idPorTituloBase.get(tituloBase(candidato.tituloMedia));
      if (!idRealNovo) {
        totalNaoRecuperaveis++;
        detalhes.push({
          linha: i + 1,
          topicoAntigo: topicoVal,
          ok: false,
          motivo: `Título recuperado ("${candidato.tituloMedia}") não tem ID de tópico real hoje.`,
        });
        continue;
      }

      await sheetsService.updateValues(cfg.commentSheet, `${colLetter(colTopico)}${i + 1}`, [[idRealNovo]]);
      totalCorrigidos++;
      detalhes.push({
        linha: i + 1,
        topicoAntigo: topicoVal,
        topicoNovo: idRealNovo,
        titulo: candidato.tituloMedia,
        ok: true,
      });
    }

    resultadosPorAba.push({ aba: cfg.commentSheet, corrigidos: detalhes.filter((d) => d.ok).length, detalhes });
  }

  return jsonResponse({ success: true, totalCorrigidos, totalNaoRecuperaveis, resultadosPorAba });
}

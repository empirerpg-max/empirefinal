// Três ações admin-only disparadas direto do tópico do Fórum (ver
// Forum.tsx) — nenhuma delas passa pela tela de Gestão. Motivadas pelo bug
// real diagnosticado em 2026-10: a faixa "Wonderwall" (álbum da Hayley)
// teve o checkbox "abrir tópico" marcado por engano no upload da faixa
// dentro do álbum, criando um tópico de fórum pra uma faixa que devia ter
// ficado pendente (publicada só depois, via "faixas sem álbum" normal).
// Não existia nenhuma forma de desfazer isso sem apagar a faixa inteira —
// "marcar como pendente" resolve exatamente esse caso, sem perder nenhum
// dado (áudio, capa, álbum, etc).
import {
  googleSheetsService,
  normalizeComparison,
  normalizeText,
} from "../services/googleSheetsService";
import { requestProvesAdmin } from "../services/sessionService";
import { registrarLogSistema } from "../services/logSistemaService";
import { getCatalogoDb } from "../services/catalogoDbService";
import { mirrorMusicaRowParaD1 } from "./gestaoController";

type TipoTopico = "musica" | "video" | "album";

const COMENTARIOS_SHEET_POR_TIPO: Record<TipoTopico, string> = {
  musica: "Comentarios_Musicas",
  video: "Comentarios_MV",
  album: "Comentarios_Albuns",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Comentários (e reações — gravadas na MESMA linha, colunas E/F conforme a
// aba, ver forumController.ts/buildCommentRow) tratados pelo ID do tópico
// na coluna A, igual nas 3 abas de comentário. Devolve quantas linhas
// apagou.
async function apagarComentariosDoTopico(tipo: TipoTopico, idTopico: string): Promise<number> {
  const sheet = COMENTARIOS_SHEET_POR_TIPO[tipo];
  const rows = await googleSheetsService.principal.readValues(sheet).catch(() => []);
  const idNorm = normalizeComparison(idTopico);
  const linhas: number[] = [];
  for (let i = 1; i < rows.length; i++) {
    if (normalizeComparison(rows[i]?.[0] || "") === idNorm) linhas.push(i + 1);
  }
  if (linhas.length > 0) {
    await googleSheetsService.principal.deleteRows(sheet, linhas);
  }
  return linhas.length;
}

interface LinhaAlvo {
  rowIndex: number; // 1-based, na planilha
  row: string[];
}

// Acha a linha de Musicas/Music Videos/Albuns pelo "ID do tópico" (coluna
// B em Musicas/Albuns, F em Music Videos — ver colunas documentadas em
// forumController.ts/createCommentController).
async function acharLinhaPorTopico(tipo: TipoTopico, idTopico: string): Promise<LinhaAlvo | null> {
  const sheetName = tipo === "musica" ? "Musicas" : tipo === "video" ? "Music Videos" : "Albuns";
  const colIdTopico = tipo === "video" ? 5 : 1; // F : B
  const rows = await googleSheetsService.principal.readValues(sheetName);
  const idNorm = normalizeComparison(idTopico);
  for (let i = 1; i < rows.length; i++) {
    if (normalizeComparison(rows[i]?.[colIdTopico] || "") === idNorm) {
      return { rowIndex: i + 1, row: rows[i] };
    }
  }
  return null;
}

/**
 * POST /api/empire-play/admin/marcar-pendente
 * Body: { tipo: "musica" | "video" | "album", idTopico: string }
 *
 * Volta uma mídia que teve tópico aberto por engano pro estado "pendente"
 * (como se o tópico nunca tivesse existido), SEM apagar nenhum dado da
 * mídia em si (áudio, capa, álbum, título, etc). Música é o caso real que
 * motivou isso (coluna X "pendente" existe só em Musicas); Music Videos e
 * Albuns não têm esse conceito de pendência na planilha — pra eles, o
 * efeito equivalente é "desvincular o tópico" (limpa o ID do tópico e
 * apaga os comentários), já que não existe coluna "pendente" pra marcar.
 */
export async function marcarPendenteController(request: Request): Promise<Response> {
  try {
    if (!(await requestProvesAdmin(request))) {
      return jsonResponse({ success: false, error: "Acesso restrito ao admin." }, 403);
    }
    const body = (await request.json()) as { tipo?: TipoTopico; idTopico?: string };
    const tipo = body.tipo;
    const idTopico = (body.idTopico || "").trim();
    if (!tipo || !idTopico || !COMENTARIOS_SHEET_POR_TIPO[tipo]) {
      return jsonResponse(
        { success: false, error: "Campos 'tipo' (musica/video/album) e 'idTopico' são obrigatórios." },
        400,
      );
    }

    const alvo = await acharLinhaPorTopico(tipo, idTopico);
    if (!alvo) {
      return jsonResponse({ success: false, error: "Tópico não encontrado na planilha." }, 404);
    }

    const titulo =
      tipo === "musica"
        ? normalizeText(alvo.row[7])
        : tipo === "video"
          ? normalizeText(alvo.row[1])
          : normalizeText(alvo.row[6]);

    let comentariosApagados = 0;
    if (tipo === "musica") {
      // B (idTopico) e F (comentariosPara) em branco, X (pendente) = "Sim".
      // Todo o resto da linha (título, áudio, capa, álbum...) fica intacto.
      await googleSheetsService.principal.updateValuesBatch([
        { sheetName: "Musicas", range: `B${alvo.rowIndex}`, values: [[""]] },
        { sheetName: "Musicas", range: `F${alvo.rowIndex}`, values: [[""]] },
        { sheetName: "Musicas", range: `X${alvo.rowIndex}`, values: [["Sim"]] },
      ]);
      // Relê a linha inteira (já com os campos limpos) e reespelha pro D1
      // `musicas` — mesmo padrão de updateFaixaLetraController.
      await mirrorMusicaRowParaD1(alvo.rowIndex);
    } else if (tipo === "video") {
      // Music Videos não tem coluna "pendente"/"comentariosPara" própria —
      // só dá pra desvincular o tópico mesmo (limpa F, o message_thread_id).
      await googleSheetsService.principal.updateValues("Music Videos", `F${alvo.rowIndex}`, [[""]]);
      // O espelho D1 (`midia`, legado) usa o próprio ID do tópico como PK —
      // não tem como "zerar" essa chave num upsert, então a linha é
      // removida: o efeito pro Fórum/Catálogo (que leem do D1) é o mesmo de
      // "esse tópico nunca existiu", sem tocar a linha real da planilha.
      const db = getCatalogoDb();
      if (db) {
        await db.prepare("DELETE FROM midia WHERE id = ?").bind(idTopico).run().catch(() => {});
      }
    } else {
      // Albuns: B (ID do tópico) e D (comentários para) em branco.
      await googleSheetsService.principal.updateValuesBatch([
        { sheetName: "Albuns", range: `B${alvo.rowIndex}`, values: [[""]] },
        { sheetName: "Albuns", range: `D${alvo.rowIndex}`, values: [[""]] },
      ]);
      const db = getCatalogoDb();
      if (db) {
        await db.prepare("DELETE FROM midia WHERE id = ?").bind(idTopico).run().catch(() => {});
      }
    }

    comentariosApagados = await apagarComentariosDoTopico(tipo, idTopico);

    await registrarLogSistema({
      categoria: "Ação concluída",
      oQueAconteceu: `Admin marcou "${titulo || idTopico}" (${tipo}) como pendente — tópico ${idTopico} desfeito, ${comentariosApagados} comentário(s) removido(s).`,
      onde: "marcarPendenteController",
    }).catch(() => {});

    return jsonResponse({ success: true, data: { titulo, comentariosApagados } });
  } catch (err: any) {
    console.error("[marcarPendenteController] Erro:", err);
    return jsonResponse({ success: false, error: err?.message || "Erro ao marcar como pendente." }, 500);
  }
}

// Acha, por "Código único", a linha em EDIÇÃO CHARTS (música, código em
// BD/55) ou EDIÇÃO CHARTS ÁLBUMS (álbum, código em R/17) — ver
// lerCodigoUnicoGerado/registrarAlbumNaEdicaoChartsAlbuns em
// gestaoController.ts.
async function limparLinhaEdicaoCharts(tipo: TipoTopico, codigoUnico: string): Promise<boolean> {
  if (!codigoUnico) return false;
  if (tipo === "video") return false; // vídeo não tem linha própria em EDIÇÃO CHARTS — usa a da música vinculada, que não deve ser tocada aqui.
  const sheet = tipo === "album" ? "EDIÇÃO CHARTS ÁLBUMS" : "EDIÇÃO CHARTS";
  const colCodigo = tipo === "album" ? "R" : "BD";
  const lastCol = tipo === "album" ? "R" : "BD";
  const rows = await googleSheetsService.edicaoCharts.readValues(sheet, `${colCodigo}:${colCodigo}`);
  const codigoNorm = normalizeComparison(codigoUnico);
  const rowIndex = rows.findIndex((r, i) => i > 0 && normalizeComparison(r?.[0] || "") === codigoNorm);
  if (rowIndex === -1) return false;
  const linha = rowIndex + 1;
  // Prefere LIMPAR em vez de apagar a linha de verdade (ver CLAUDE.md desta
  // task) — várias outras rotinas (cálculo de semanas, multiplicadores)
  // assumem índice de linha estático aqui; apagar deslocaria tudo abaixo.
  // updateValues com array vazio não limpa célula nenhuma no Sheets (não
  // sobrescreve nada) — grava explicitamente uma linha de strings vazias
  // do tamanho certo.
  const colStart = "A";
  const width = colLetterToIndex(lastCol) - colLetterToIndex(colStart) + 1;
  await googleSheetsService.edicaoCharts.updateValues(
    sheet,
    `${colStart}${linha}:${lastCol}${linha}`,
    [new Array(width).fill("")],
  );
  return true;
}

function colLetterToIndex(letter: string): number {
  let idx = 0;
  for (const ch of letter) idx = idx * 26 + (ch.toUpperCase().charCodeAt(0) - 64);
  return idx - 1;
}

/**
 * POST /api/empire-play/admin/excluir-topico
 * Body: { tipo: "musica" | "video" | "album", idTopico: string }
 *
 * EXCEÇÃO deliberada à regra "nunca apagar linha de Sheets" (autorizada
 * explicitamente pelo usuário/admin pra esta ação específica) — apaga de
 * verdade a linha de Musicas/Music Videos/Albuns, limpa a linha
 * correspondente em EDIÇÃO CHARTS/EDIÇÃO CHARTS ÁLBUMS, remove a entrada do
 * D1 (`musicas` por código único e/ou `midia` legado por id) e apaga todo
 * comentário (com reação) do tópico. Irreversível — por isso o log
 * registra o máximo de detalhe possível.
 */
export async function excluirTopicoController(request: Request): Promise<Response> {
  try {
    if (!(await requestProvesAdmin(request))) {
      return jsonResponse({ success: false, error: "Acesso restrito ao admin." }, 403);
    }
    const body = (await request.json()) as { tipo?: TipoTopico; idTopico?: string };
    const tipo = body.tipo;
    const idTopico = (body.idTopico || "").trim();
    if (!tipo || !idTopico || !COMENTARIOS_SHEET_POR_TIPO[tipo]) {
      return jsonResponse(
        { success: false, error: "Campos 'tipo' (musica/video/album) e 'idTopico' são obrigatórios." },
        400,
      );
    }

    const alvo = await acharLinhaPorTopico(tipo, idTopico);
    if (!alvo) {
      return jsonResponse({ success: false, error: "Tópico não encontrado na planilha." }, 404);
    }

    const sheetName = tipo === "musica" ? "Musicas" : tipo === "video" ? "Music Videos" : "Albuns";
    const titulo =
      tipo === "musica"
        ? normalizeText(alvo.row[7])
        : tipo === "video"
          ? normalizeText(alvo.row[1])
          : normalizeText(alvo.row[6]);
    const codigoUnico =
      tipo === "musica"
        ? normalizeText(alvo.row[25])
        : tipo === "video"
          ? normalizeText(alvo.row[20])
          : normalizeText(alvo.row[11]);

    // 1. Comentários + reações do tópico (sempre primeiro — se algo mais
    // abaixo falhar, não sobra comentário órfão apontando pra uma linha
    // que já vai deixar de existir).
    const comentariosApagados = await apagarComentariosDoTopico(tipo, idTopico);

    // 2. EDIÇÃO CHARTS / EDIÇÃO CHARTS ÁLBUMS — limpa a linha pelo código
    // único (vídeo não tem linha própria aqui, pula).
    const edicaoChartsLimpa = await limparLinhaEdicaoCharts(tipo, codigoUnico).catch((err) => {
      console.warn("[excluirTopicoController] Erro ao limpar EDIÇÃO CHARTS:", err);
      return false;
    });

    // 3. D1 — tabela dedicada `musicas` (por código único) e/ou `midia`
    // legada (por id = idTopico).
    const db = getCatalogoDb();
    if (db) {
      if (tipo === "musica" && codigoUnico) {
        await db.prepare("DELETE FROM musicas WHERE codigo_unico = ?").bind(codigoUnico).run().catch(() => {});
      }
      await db.prepare("DELETE FROM midia WHERE id = ?").bind(idTopico).run().catch(() => {});
    }

    // 4. Por último, a linha real na planilha — EXCEÇÃO explícita à regra
    // de nunca apagar linha (ver CLAUDE.md), autorizada pelo usuário só
    // pra esta ação.
    await googleSheetsService.principal.deleteRows(sheetName, [alvo.rowIndex]);

    await registrarLogSistema({
      categoria: "Ação concluída",
      oQueAconteceu: `Admin EXCLUIU o tópico "${titulo || idTopico}" (${tipo}, idTopico=${idTopico}, código único=${codigoUnico || "—"}) — linha ${alvo.rowIndex} de "${sheetName}" apagada, ${comentariosApagados} comentário(s) removido(s), EDIÇÃO CHARTS ${edicaoChartsLimpa ? "limpa" : "não encontrada/ignorada"}, D1 limpo. Ação irreversível.`,
      onde: "excluirTopicoController",
    }).catch(() => {});

    return jsonResponse({
      success: true,
      data: { titulo, comentariosApagados, edicaoChartsLimpa },
    });
  } catch (err: any) {
    console.error("[excluirTopicoController] Erro:", err);
    return jsonResponse({ success: false, error: err?.message || "Erro ao excluir tópico." }, 500);
  }
}

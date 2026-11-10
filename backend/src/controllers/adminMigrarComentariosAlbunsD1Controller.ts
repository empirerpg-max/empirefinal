import { googleSheetsService, normalizeText } from "../services/googleSheetsService";
import {
  getCatalogoDb,
  buildComentarioAlbumInsertStatement,
  type ComentarioAlbumInsert,
} from "../services/comentariosAlbunsDbService";
import { executarEmLotes, type ItemComRotulo } from "../services/catalogoDbService";

// Migração Comentarios_Albuns (Sheets) -> tabela D1 `comentarios_albuns`.
// Diferente da migração de música (comentariosMusicasDbService), não precisa
// resolver "código único" nenhum — a chave aqui já É o "ID do tópico"
// (coluna A), direto, sem FK pra nenhuma tabela "albuns" no D1 (que não
// existe). Sem ID estável por linha no Sheets — migração é DELETE+INSERT
// completo a cada rodada, idempotente por substituição total.
//
// GET /api/empire-play/admin/migrar-comentarios-albuns-d1
export async function adminMigrarComentariosAlbunsD1Controller(): Promise<Response> {
  const db = getCatalogoDb();
  if (!db) {
    return new Response(JSON.stringify({ success: false, error: "Binding CATALOGO_DB não disponível." }), {
      status: 500,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  // Comentarios_Albuns: A ID do tópico, B ID do jogador, C Nome do jogador,
  // D Comentário, E Data/Hora, F Reações, G ID do comentário-pai.
  const rows = await googleSheetsService.principal.readValues("Comentarios_Albuns", "A:G").catch(() => []);

  const resultado = {
    lidas: 0,
    migradas: 0,
    linhasQuebradas: [] as { linha: number }[],
    falhas: [] as { rotulo: string; erro: string }[],
  };

  const itens: ItemComRotulo[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !row.some((c) => normalizeText(c))) continue;
    resultado.lidas++;

    const topicId = normalizeText(row[0]); // A
    const comentario = normalizeText(row[3]); // D
    if (!topicId || !comentario) {
      resultado.linhasQuebradas.push({ linha: i + 1 });
      continue;
    }

    const item: ComentarioAlbumInsert = {
      albumTopicId: topicId,
      jogadorId: normalizeText(row[1]) || null, // B
      jogadorNome: normalizeText(row[2]) || null, // C
      comentario,
      reacoesJson: normalizeText(row[5]) || null, // F
      dataHora: normalizeText(row[4]) || null, // E
      replyTo: null, // G — "ID do comentário-pai" no Sheets não é um ID D1 (autoincrement); sem migração segura possível aqui.
    };

    itens.push({
      statement: buildComentarioAlbumInsertStatement(db, item),
      rotulo: `linha ${i + 1} — ${topicId}`,
    });
  }

  // Limpa tudo antes de reinserir — sem isso, rodar de novo duplicaria cada
  // comentário (não tem upsert possível sem ID estável do Sheets).
  await db.prepare("DELETE FROM comentarios_albuns").run();

  const { executados, falhas } = await executarEmLotes(db, itens);
  resultado.migradas = executados;
  resultado.falhas = falhas;

  return new Response(JSON.stringify({ success: falhas.length === 0, ...resultado }, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

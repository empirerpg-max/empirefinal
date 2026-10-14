import { googleSheetsService, normalizeText } from "../services/googleSheetsService";
import {
  getCatalogoDb,
  buildComentarioMusicaInsertStatement,
  type ComentarioMusicaInsert,
} from "../services/comentariosMusicasDbService";
import { executarEmLotes, type ItemComRotulo } from "../services/catalogoDbService";

// Migração Comentarios_Musicas (Sheets) -> tabela D1 `comentarios_musicas`.
// Sem ID estável por linha no Sheets (synthetic id hoje é só a posição na
// planilha) — migração é DELETE+INSERT completo a cada rodada, idempotente
// por substituição total, não por upsert linha a linha.
//
// GET /api/empire-play/admin/migrar-comentarios-musicas-d1
export async function adminMigrarComentariosMusicasD1Controller(): Promise<Response> {
  const db = getCatalogoDb();
  if (!db) {
    return new Response(JSON.stringify({ success: false, error: "Binding CATALOGO_DB não disponível." }), {
      status: 500,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  // IDs de música já migrados — usado só pra REPORTAR órfãos (comentário
  // cujo "ID do tópico" não bate com nenhuma música hoje), nunca pra
  // excluir: o comentário é migrado de qualquer forma, com evidência
  // visível de que o vínculo está quebrado, igual ao padrão já usado em
  // adminDiagComentarioPerdidoController.ts.
  const musicaIdsResult = await db.prepare("SELECT id FROM musicas").all<{ id: string }>();
  const musicaIdsExistentes = new Set((musicaIdsResult.results || []).map((r) => r.id));

  const rows = await googleSheetsService.principal.readValues("Comentarios_Musicas", "A:G").catch(() => []);

  const resultado = {
    lidas: 0,
    migradas: 0,
    orfaos: [] as { linha: number; topicId: string }[],
    falhas: [] as { rotulo: string; erro: string }[],
  };

  const itens: ItemComRotulo[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !row.some((c) => normalizeText(c))) continue;
    resultado.lidas++;

    const topicId = normalizeText(row[0]); // A
    const comentario = normalizeText(row[3]); // D
    if (!topicId || !comentario) continue; // linha quebrada, sem como migrar

    if (!musicaIdsExistentes.has(topicId)) {
      resultado.orfaos.push({ linha: i + 1, topicId });
    }

    const item: ComentarioMusicaInsert = {
      musicaId: topicId,
      jogadorId: normalizeText(row[1]) || null, // B
      jogadorNome: normalizeText(row[2]) || null, // C
      comentario,
      reacoesJson: normalizeText(row[4]) || null, // E
      dataHora: normalizeText(row[5]) || null, // F
      replyTo: null, // G — "ID do comentário-pai" no Sheets não é um ID D1 (autoincrement) ainda; sem migração segura possível aqui, fica null (0 replies encontrados nos dados exportados em 2026-10-14)
    };

    itens.push({
      statement: buildComentarioMusicaInsertStatement(db, item),
      rotulo: `linha ${i + 1} — ${topicId}`,
    });
  }

  // Limpa tudo antes de reinserir — sem isso, rodar de novo duplicaria
  // cada comentário (não tem upsert possível sem ID estável do Sheets).
  await db.prepare("DELETE FROM comentarios_musicas").run();

  const { executados, falhas } = await executarEmLotes(db, itens);
  resultado.migradas = executados;
  resultado.falhas = falhas;

  return new Response(JSON.stringify({ success: falhas.length === 0, ...resultado }, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

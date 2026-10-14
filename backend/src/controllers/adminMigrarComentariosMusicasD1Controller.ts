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

  // Resolve ID antigo -> ID real atual: algumas linhas de Musicas têm um
  // "Comentários para" (coluna F) preenchido com um ID DE TÓPICO ANTIGO que
  // a própria linha já teve (antes de ser recriada com um id novo) — não um
  // redirecionamento de OUTRA faixa pra esta, mas a própria linha carregando
  // seu id anterior. Comentário salvo sob esse id antigo pertence de
  // verdade à linha atual, só que com um id desatualizado. Confirmado ao
  // vivo em 2026-10-14: "Dagny - JULY (MTV 00's Version)" tem "Comentários
  // para"="musica_1790776873735_5bxka4" mas "ID do tópico" real é
  // "musica_1791984586511_17bp05" — os 5 comentários com o id antigo
  // pertencem a essa música, não são órfãos de verdade.
  const idAntigoParaIdReal = new Map<string, string>();
  const musicasParaResolverRedirecionamento = await googleSheetsService.principal
    .readValues("Musicas", "A:F")
    .catch(() => []);
  for (let i = 1; i < musicasParaResolverRedirecionamento.length; i++) {
    const row = musicasParaResolverRedirecionamento[i];
    if (!row) continue;
    const idReal = normalizeText(row[1]); // B
    const idAntigo = normalizeText(row[5]); // F — "Comentários para"
    if (idReal && idAntigo && idAntigo !== idReal) {
      idAntigoParaIdReal.set(idAntigo, idReal);
    }
  }

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

    const topicIdBruto = normalizeText(row[0]); // A
    const comentario = normalizeText(row[3]); // D
    if (!topicIdBruto || !comentario) continue; // linha quebrada, sem como migrar

    // Resolve id antigo -> id real ANTES de checar órfão (ver mapa acima) —
    // o comentário pertence à música de verdade, só foi salvo com um id que
    // ela já não usa mais.
    const topicId = idAntigoParaIdReal.get(topicIdBruto) || topicIdBruto;

    if (!musicaIdsExistentes.has(topicId)) {
      // Órfão de verdade (mesma categoria já confirmada antes nesta sessão:
      // comentário referenciando mídia substituída/excluída) — D1 tem FK
      // real (musica_id REFERENCES musicas(id)), então INSERT falharia de
      // qualquer forma. Reportado com evidência completa, mas não inserido
      // (nunca teria como, sem inventar uma música que não existe).
      resultado.orfaos.push({ linha: i + 1, topicId: topicIdBruto });
      continue;
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

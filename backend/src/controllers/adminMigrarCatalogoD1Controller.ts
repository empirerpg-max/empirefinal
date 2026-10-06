import { googleSheetsService, normalizeText } from "../services/googleSheetsService";
import {
  getCatalogoDb,
  buildMidiaUpsertStatement,
  buildComentarioInsertStatement,
  executarEmLotes,
  type MidiaUpsert,
  type ComentarioInsert,
} from "../services/catalogoDbService";

// Fase 1 da migração Google Sheets -> D1: migração em LOTE de tudo que já
// existe hoje (músicas/vídeos/álbuns + seus comentários) pro banco D1
// (espelho em paralelo — Sheets continua sendo a fonte de verdade).
// Idempotente: roda de novo sem duplicar nada (midia usa INSERT ... ON
// CONFLICT DO UPDATE; comentario é limpo e regravado do zero a cada rodada,
// já que não tem um ID estável vindo do Sheets pra fazer upsert por linha).
//
// BUG CORRIGIDO (2026-10-06): a primeira versão gravava uma linha de cada
// vez (await sequencial, ~3235 idas-e-voltas ao D1 numa chamada só) —
// estourou os 45s de timeout do admin-call.yml nas 3 tentativas, sem
// nenhuma linha migrada. Agora monta todas as declarações primeiro e grava
// em LOTES via db.batch() (uma viagem de rede por lote de 50), centenas de
// vezes mais rápido.
//
// GET /api/empire-play/admin/migrar-catalogo-d1
function parseDateToIso(dataBR: string | null): string | null {
  if (!dataBR) return null;
  const m = dataBR.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

export async function adminMigrarCatalogoD1Controller(): Promise<Response> {
  const db = getCatalogoDb();
  if (!db) {
    return new Response(JSON.stringify({ success: false, error: "Binding CATALOGO_DB não disponível." }), {
      status: 500,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  const resultado = {
    musicas: { lidas: 0, migradas: 0 },
    videos: { lidas: 0, migradas: 0 },
    albuns: { lidas: 0, migradas: 0 },
    comentariosMusicas: { lidas: 0, migradas: 0 },
    comentariosVideos: { lidas: 0, migradas: 0 },
    comentariosAlbuns: { lidas: 0, migradas: 0 },
  };

  const midiaItems: MidiaUpsert[] = [];

  // --- Músicas ---
  const musicasRows = await googleSheetsService.principal.readValues("Musicas", "A:AA").catch(() => []);
  for (let i = 1; i < musicasRows.length; i++) {
    const row = musicasRows[i];
    if (!row || !row.some((c) => normalizeText(c))) continue;
    resultado.musicas.lidas++;
    const topicId = normalizeText(row[1]); // B
    if (!topicId) continue; // sem ID estável ainda — fica pra próxima rodada depois de comentado/backfillado
    const dataLancamento = normalizeText(row[0]) || null; // A
    // ARTISTA 2-6 (colunas O-S, índices 14-18) — feats além do ACT
    // PRINCIPAL. Faltava no script original (gap confirmado pelo usuário:
    // feat_artistas chegava sempre vazio no D1).
    const featArtistas = [row[14], row[15], row[16], row[17], row[18]]
      .map((v) => normalizeText(v))
      .filter((v): v is string => !!v);
    midiaItems.push({
      id: topicId,
      tipo: "musica",
      titulo: normalizeText(row[7]) || "Sem título", // H
      artista: normalizeText(row[13]) || "Artista não informado", // N — ACT PRINCIPAL
      featArtistas: featArtistas.length ? featArtistas : undefined,
      capaUrl: normalizeText(row[3]) || null, // D
      audioUrl: normalizeText(row[2]) || null, // C
      letra: normalizeText(row[4]) || null, // E
      dataLancamento,
      dataLancamentoIso: parseDateToIso(dataLancamento),
      codigoUnico: normalizeText(row[25]) || null, // Z
      genero: normalizeText(row[19]) || null, // T
      trackOrder: Number(normalizeText(row[20])) || null, // U
      pendente: normalizeText(row[23]).toLowerCase() === "sim",
    });
    resultado.musicas.migradas++;
  }

  // --- Music Videos ---
  const videosRows = await googleSheetsService.principal.readValues("Music Videos", "A:T").catch(() => []);
  for (let i = 1; i < videosRows.length; i++) {
    const row = videosRows[i];
    if (!row || !row.some((c) => normalizeText(c))) continue;
    resultado.videos.lidas++;
    const topicId = normalizeText(row[5]); // F — message_thread_id
    if (!topicId) continue;
    const dataEnvio = normalizeText(row[9]) || null; // J
    midiaItems.push({
      id: topicId,
      tipo: "video",
      titulo: normalizeText(row[1]) || "Sem título", // B
      artista: "", // Music Videos não tem coluna própria de artista — resolvido via "Nome original nos charts" (P) quando necessário
      videoUrl: normalizeText(row[12]) || null, // M
      categoria: normalizeText(row[7]) || null, // H — Tipo de vídeo
      descricao: normalizeText(row[8]) || null, // I
      dataLancamento: dataEnvio,
      dataLancamentoIso: parseDateToIso(dataEnvio),
    });
    resultado.videos.migradas++;
  }

  // --- Álbuns ---
  const albunsRows = await googleSheetsService.principal.readValues("Albuns", "A:L").catch(() => []);
  for (let i = 1; i < albunsRows.length; i++) {
    const row = albunsRows[i];
    if (!row || !row.some((c) => normalizeText(c))) continue;
    resultado.albuns.lidas++;
    const topicId = normalizeText(row[1]); // B
    if (!topicId) continue;
    const nomeAlbum = normalizeText(row[6]) || "Sem título"; // G — Novo Nome
    const dashMatch = nomeAlbum.match(/^(.+?)\s[-–—]\s(.+)$/);
    const dataLancamento = normalizeText(row[0]) || null; // A
    midiaItems.push({
      id: topicId,
      tipo: "album",
      titulo: dashMatch ? dashMatch[2].trim() : nomeAlbum,
      artista: dashMatch ? dashMatch[1].trim() : normalizeText(row[5]) || "Artista não informado", // F — Nome do criador (fallback)
      capaUrl: normalizeText(row[2]) || null, // C
      dataLancamento,
      dataLancamentoIso: parseDateToIso(dataLancamento),
      codigoUnico: normalizeText(row[11]) || null, // L
    });
    resultado.albuns.migradas++;
  }

  // Detecta IDs duplicados ENTRE linhas diferentes do Sheets (ex: dois
  // tópicos distintos acabaram com o mesmo "ID do tópico") — midia.id é
  // PRIMARY KEY, então duas linhas-fonte com o mesmo id colapsam em UMA
  // linha no D1 via ON CONFLICT DO UPDATE (a última processada "ganha"),
  // o que faz midiaExecutadas (declarações que rodaram com sucesso) ficar
  // maior que o COUNT(*) real na tabela — sem isso parecer silenciosamente
  // com perda de dado quando na verdade é duplicidade na fonte.
  const idsVistos = new Map<string, string[]>();
  for (const item of midiaItems) {
    const chave = `${item.tipo}:${item.id}`;
    const lista = idsVistos.get(chave) ?? [];
    lista.push(item.titulo);
    idsVistos.set(chave, lista);
  }
  const idsDuplicados = Array.from(idsVistos.entries())
    .filter(([, titulos]) => titulos.length > 1)
    .map(([chave, titulos]) => ({ chave, titulos }));

  const { executados: midiaExecutadas, falhas: midiaFalhas } = await executarEmLotes(
    db,
    midiaItems.map((item) => ({
      statement: buildMidiaUpsertStatement(db, item),
      rotulo: `${item.tipo}:${item.id}:${item.titulo}`,
    })),
  );
  if (midiaExecutadas < midiaItems.length) {
    console.warn(
      `[migrar-catalogo-d1] Só ${midiaExecutadas}/${midiaItems.length} mídias confirmadas. Falhas: ${JSON.stringify(midiaFalhas)}`,
    );
  }

  // Verificação final: relê o D1 de verdade e compara com o que devia estar
  // lá — em vez de confiar em qualquer contador intermediário (migradas,
  // executadas, falhas, duplicados), que já se mostraram incompletos pelo
  // menos uma vez cada nesta investigação (2026-10-06).
  const idsNoD1 = new Set<string>();
  const { results: linhasD1 } = await db.prepare("SELECT id FROM midia").all<{ id: string }>();
  for (const row of linhasD1) idsNoD1.add(row.id);
  const midiaAusenteDoD1 = midiaItems
    .filter((item) => !idsNoD1.has(item.id))
    .map((item) => ({ tipo: item.tipo, id: item.id, titulo: item.titulo }));

  // --- Comentários (limpa e regrava do zero a cada rodada — idempotente) ---
  await db
    .prepare("DELETE FROM comentario")
    .run()
    .catch((err) => console.warn("[migrar-catalogo-d1] Falha ao limpar comentario:", err));

  const comentarioItems: ComentarioInsert[] = [];
  const coletarComentarios = async (
    sheet: string,
    colTopicId: number,
    colJogadorId: number,
    colJogador: number,
    colTexto: number,
    contador: { lidas: number; migradas: number },
  ) => {
    const rows = await googleSheetsService.principal.readValues(sheet).catch(() => []);
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || !row.some((c) => normalizeText(c))) continue;
      contador.lidas++;
      const topicId = normalizeText(row[colTopicId]);
      const texto = normalizeText(row[colTexto]);
      if (!topicId || !texto) continue;
      comentarioItems.push({
        midiaId: topicId,
        jogadorId: normalizeText(row[colJogadorId]) || "desconhecido",
        jogadorNome: normalizeText(row[colJogador]) || "Anônimo",
        texto,
      });
      contador.migradas++;
    }
  };

  await coletarComentarios("Comentarios_Musicas", 0, 1, 2, 3, resultado.comentariosMusicas);
  await coletarComentarios("Comentarios_MV", 0, 1, 2, 3, resultado.comentariosVideos);
  await coletarComentarios("Comentarios_Albuns", 0, 1, 2, 3, resultado.comentariosAlbuns);

  const { executados: comentariosExecutados, falhas: comentariosFalhas } = await executarEmLotes(
    db,
    comentarioItems.map((c) => ({
      statement: buildComentarioInsertStatement(db, c),
      rotulo: `${c.midiaId}:${c.jogadorId}:${c.texto.slice(0, 40)}`,
    })),
  );
  if (comentariosExecutados < comentarioItems.length) {
    console.warn(
      `[migrar-catalogo-d1] Só ${comentariosExecutados}/${comentarioItems.length} comentários confirmados. Falhas: ${JSON.stringify(comentariosFalhas.slice(0, 50))}`,
    );
  }

  return new Response(
    JSON.stringify(
      {
        success: true,
        resultado,
        midiaExecutadas,
        midiaFalhas,
        totalIdsDuplicados: idsDuplicados.length,
        idsDuplicados,
        totalMidiaAusenteDoD1: midiaAusenteDoD1.length,
        midiaAusenteDoD1,
        comentariosExecutados,
        totalComentariosFalhas: comentariosFalhas.length,
        comentariosFalhas: comentariosFalhas.slice(0, 50),
      },
      null,
      2,
    ),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
}

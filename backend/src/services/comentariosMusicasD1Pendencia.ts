// Marca tópicos de música cujo espelho em `comentarios_musicas` (D1) ficou
// INCOMPLETO — ou seja, existe comentário salvo na planilha
// Comentarios_Musicas que não chegou no D1.
//
// BUG REAL (2026-11-23, Andrei em "Hayley Wonderwall - Beautiful
// Distortion"): o comentário foi salvo na planilha, mas o espelho no D1
// falhou em silêncio. O caminho rápido do tópico
// (getEmpirePlayForumTopicController) confia SÓ no D1 quando ele já tem 1+
// comentário daquele tópico — então o comentário que faltou ficava
// invisível pra sempre, sem erro nenhum pra ninguém.
//
// Com a marca no KV FLAGS, o caminho rápido pula esse tópico e lê pela
// planilha (mais lento, mas sempre completo). Pra voltar ao caminho rápido
// depois de copiar pro D1 o que faltou, é só apagar a chave no KV.
//
// KV (não D1) de propósito: a marca precisa ser gravada justamente quando o
// D1 falhou.
interface KvLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
}
function flagsKv(): KvLike | undefined {
  return (globalThis as Record<string, unknown>).__FLAGS_KV__ as KvLike | undefined;
}

const PREFIXO = "forum:musicas-d1-incompleto:";

export async function marcarTopicoMusicaD1Incompleto(
  topicId: string,
  motivo: string,
): Promise<void> {
  if (!topicId) return;
  const kv = flagsKv();
  if (!kv) return;
  try {
    await kv.put(PREFIXO + topicId, JSON.stringify({ motivo, em: new Date().toISOString() }));
  } catch (err) {
    console.warn(
      "[comentariosMusicasD1Pendencia] Não consegui marcar o tópico como incompleto:",
      topicId,
      err,
    );
  }
}

/** true = o D1 não tem todos os comentários desse tópico; leia pela planilha. */
export async function topicoMusicaD1Incompleto(topicId: string): Promise<boolean> {
  if (!topicId) return false;
  const kv = flagsKv();
  if (!kv) return false;
  try {
    return (await kv.get(PREFIXO + topicId)) !== null;
  } catch {
    // Sem como saber: na dúvida, lê pela planilha (nunca esconde comentário).
    return true;
  }
}

// Preenche comentarios_musicas.id_topico (2026-11-18): a identidade de um
// comentário no Fórum é o tópico da música (cada versão tem o seu), não o
// código único. Casa cada comentário do D1 com a linha da aba
// "Comentarios_Musicas" (A = tópico, D = comentário, F = data) pelo texto +
// data. Só grava id_topico; nada mais muda.
//
// GET /api/empire-play/admin/topico-comentarios-musicas            -> simulação
// GET /api/empire-play/admin/topico-comentarios-musicas?confirmar=1 -> grava
import { getCatalogoDb } from "../services/catalogoDbService";
import { normalizeComparison, normalizeText, readValuesFresh } from "../services/googleSheetsService";
import { registrarLogSistema } from "../services/logSistemaService";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });
}
const k = (comentario: string, data: string) => `${normalizeComparison(comentario)}|${normalizeText(data)}`;

export async function adminTopicoComentariosMusicasController(request: Request): Promise<Response> {
  const confirmar = new URL(request.url).searchParams.get("confirmar") === "1";
  const db = getCatalogoDb();
  if (!db) return json({ success: false, error: "sem D1" }, 500);
  try {
    const [rows, comentarios, musicas] = await Promise.all([
      readValuesFresh("principal", "Comentarios_Musicas", "A:G"),
      db.prepare("SELECT id, musica_id, comentario, data_hora FROM comentarios_musicas WHERE coalesce(id_topico, '') = ''")
        .all<{ id: number; musica_id: string; comentario: string; data_hora: string | null }>(),
      db.prepare("SELECT codigo_unico, id_topico FROM musicas WHERE coalesce(id_topico, '') <> ''")
        .all<{ codigo_unico: string | null; id_topico: string }>(),
    ]);
    const topicosPorChave = new Map<string, Set<string>>();
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i] || [];
      const topico = normalizeText(r[0]);
      if (!topico || !normalizeText(r[3])) continue;
      const chave = k(r[3], r[5] || "");
      (topicosPorChave.get(chave) || topicosPorChave.set(chave, new Set()).get(chave)!).add(topico);
    }
    const topicosPorCodigo = new Map<string, string[]>();
    for (const m of musicas.results || []) {
      const c = normalizeComparison(m.codigo_unico || "");
      (topicosPorCodigo.get(c) || topicosPorCodigo.set(c, []).get(c)!).push(m.id_topico);
    }
    const doCodigo = (c: string) => topicosPorCodigo.get(normalizeComparison(c)) || [];
    const updates: { id: number; topico: string; como: string }[] = [];
    const semSolucao: { id: number; musicaId: string; inicio: string; motivo: string }[] = [];
    for (const c of comentarios.results || []) {
      const naPlanilha = [...(topicosPorChave.get(k(c.comentario, c.data_hora || "")) || [])];
      const versoes = doCodigo(c.musica_id);
      // na planilha: o tópico tem que ser de uma versão desse código
      const validos = naPlanilha.filter((t) => versoes.includes(t));
      if (validos.length === 1) updates.push({ id: c.id, topico: validos[0], como: "planilha" });
      else if (validos.length === 0 && naPlanilha.length === 0 && versoes.length === 1)
        updates.push({ id: c.id, topico: versoes[0], como: "codigo-com-uma-versao" });
      else
        semSolucao.push({
          id: c.id,
          musicaId: c.musica_id,
          inicio: (c.comentario || "").slice(0, 60),
          motivo: validos.length > 1 ? "texto+data em mais de uma versão" : naPlanilha.length ? `planilha aponta ${naPlanilha.join(",")} (não é versão do código)` : `não está na planilha e o código tem ${versoes.length} versões`,
        });
    }
    if (confirmar && updates.length) {
      for (let i = 0; i < updates.length; i += 50) {
        await db.batch(
          updates.slice(i, i + 50).map((u) =>
            db.prepare("UPDATE comentarios_musicas SET id_topico = ? WHERE id = ? AND coalesce(id_topico, '') = ''").bind(u.topico, u.id),
          ),
        );
      }
      await registrarLogSistema({
        categoria: "Ação concluída",
        oQueAconteceu: `Comentários de música ligados ao tópico da música (D1): ${updates.length} preenchidos, ${semSolucao.length} sem solução (ficam no caminho normal do Fórum).`,
        onde: "adminTopicoComentariosMusicasController",
        detalheTecnico: JSON.stringify({ semSolucao }).slice(0, 45000),
      }).catch(() => {});
    }
    const porComo = updates.reduce<Record<string, number>>((a, u) => ((a[u.como] = (a[u.como] || 0) + 1), a), {});
    return json({ success: true, simulacao: !confirmar, semTopico: (comentarios.results || []).length, preenchidos: updates.length, porComo, semSolucao: semSolucao.slice(0, 40), totalSemSolucao: semSolucao.length });
  } catch (err) {
    return json({ success: false, error: (err as Error).message }, 500);
  }
}

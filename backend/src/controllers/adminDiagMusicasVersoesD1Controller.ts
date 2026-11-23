// Diagnóstico SÓ LEITURA (2026-11-17): músicas da planilha que não estão no
// D1. A tabela `musicas` usa o Código único como chave, e versões da mesma
// música repetem o código (ex.: Bad Friend e Bad Friend (Live at Grammys))
// -> o upsert ON CONFLICT(codigo_unico) sobrescreve uma versão com a outra.
//
// GET /api/empire-play/admin/diag-musicas-versoes-d1
import { normalizeComparison, normalizeText, readValuesFresh } from "../services/googleSheetsService";
import { getCatalogoDb } from "../services/catalogoDbService";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });
}

export async function adminDiagMusicasVersoesD1Controller(): Promise<Response> {
  const db = getCatalogoDb();
  if (!db) return json({ success: false, error: "sem D1" }, 500);
  try {
    const rows = await readValuesFresh("principal", "Musicas", "A:Z");
    const d1 = (await db.prepare("SELECT codigo_unico, titulo, id_topico FROM musicas").all<{ codigo_unico: string; titulo: string; id_topico: string | null }>()).results || [];
    const noD1 = new Set(d1.map((m) => `${normalizeComparison(m.codigo_unico)}|${normalizeComparison(m.titulo)}`));
    const porCodigo = new Map<string, number[]>();
    const faltando: { linha: number; titulo: string; codigo: string; idTopico: string; pendente: string }[] = [];
    let linhasComMusica = 0;
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i] || [];
      const titulo = normalizeText(r[7]);
      const codigo = normalizeText(r[25]);
      if (!titulo && !codigo) continue;
      linhasComMusica++;
      if (codigo) (porCodigo.get(normalizeComparison(codigo)) || porCodigo.set(normalizeComparison(codigo), []).get(normalizeComparison(codigo))!).push(i + 1);
      if (!noD1.has(`${normalizeComparison(codigo)}|${normalizeComparison(titulo)}`)) {
        faltando.push({ linha: i + 1, titulo, codigo, idTopico: normalizeText(r[1]), pendente: normalizeText(r[23]) });
      }
    }
    const codigosRepetidos = [...porCodigo.entries()].filter(([, l]) => l.length > 1);
    return json({
      success: true,
      linhasComMusica,
      musicasNoD1: d1.length,
      faltandoNoD1: faltando.length,
      faltando,
      codigosRepetidosNaPlanilha: codigosRepetidos.length,
    });
  } catch (err) {
    return json({ success: false, error: (err as Error).message }, 500);
  }
}

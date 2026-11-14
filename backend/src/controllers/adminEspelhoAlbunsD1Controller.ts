// Migração dos ÁLBUNS pro D1 (2026-11-14) — ver espelhoAbasD1.ts.
//
// GET /api/empire-play/admin/espelho-albuns-d1?acao=criar       -> cria a tabela (idempotente)
// GET /api/empire-play/admin/espelho-albuns-d1?acao=sincronizar -> copia as 3 abas (troca atômica) e valida
// GET /api/empire-play/admin/espelho-albuns-d1?acao=validar     -> só compara planilha x D1, linha a linha
// (opcional &aba=Albuns|Extra_Albuns|Comentarios_Albuns pra uma aba só)
import { getCatalogoDb } from "../services/catalogoDbService";
import {
  ABAS_ALBUM,
  ESPELHO_CREATE_STATEMENTS,
  ehAbaEspelhada,
  lerAbaDaPlanilha,
  sincronizarAba,
  validarAba,
  type AbaEspelhada,
} from "../services/espelhoAbasD1";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });
}

export async function adminEspelhoAlbunsD1Controller(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const acao = url.searchParams.get("acao") || "validar";
  const abaParam = url.searchParams.get("aba") || "";
  const abas: AbaEspelhada[] = abaParam ? (ehAbaEspelhada(abaParam) ? [abaParam] : []) : [...ABAS_ALBUM];
  if (!abas.length) return json({ success: false, error: `aba inválida: ${abaParam}` }, 400);
  const db = getCatalogoDb();
  if (!db) return json({ success: false, error: "sem D1" }, 500);
  try {
    if (acao === "criar") {
      for (const s of ESPELHO_CREATE_STATEMENTS) await db.prepare(s).run();
      return json({ success: true, mensagem: "Tabela abas_espelho criada/confirmada." });
    }
    const resultados = [];
    for (const aba of abas) {
      const planilha = await lerAbaDaPlanilha(aba);
      const sync = acao === "sincronizar" ? await sincronizarAba(aba, planilha) : undefined;
      const rel = await validarAba(aba, planilha);
      resultados.push({
        ...rel,
        faltandoNoD1: rel.faltandoNoD1.slice(0, 30),
        sobrandoNoD1: rel.sobrandoNoD1.slice(0, 30),
        diferentes: rel.diferentes.slice(0, 30),
        ...(sync ? { sincronizacao: sync } : {}),
      });
    }
    return json({ success: resultados.every((r) => r.ok), acao, resultados });
  } catch (err) {
    return json({ success: false, error: (err as Error).message }, 500);
  }
}

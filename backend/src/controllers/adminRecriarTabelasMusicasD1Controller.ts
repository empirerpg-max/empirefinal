import { getCatalogoDb } from "../services/catalogoDbService";
import { MUSICAS_CREATE_STATEMENTS } from "../services/musicasDbService";
import { COMENTARIOS_MUSICAS_CREATE_STATEMENTS } from "../services/comentariosMusicasDbService";

// DROP + recriação de `musicas`/`comentarios_musicas` com o novo schema —
// pivot 2026-10-14: PK de `musicas` passa de "ID do tópico" (id) para
// "Código único" (codigo_unico), coluna antiga renomeada id_topico
// (nullable, faixa pendente de álbum não tem tópico ainda mas já tem
// código). `comentarios_musicas.musica_id` agora referencia
// musicas(codigo_unico). Sem dado de produção dependendo dessas tabelas
// ainda (D1 aqui não é lido em produção, só populado) — DROP seguro.
//
// GET /api/empire-play/admin/recriar-tabelas-musicas-d1
const RECRIAR_STATEMENTS: string[] = [
  "DROP TABLE IF EXISTS comentarios_musicas",
  "DROP TABLE IF EXISTS musicas",
  ...MUSICAS_CREATE_STATEMENTS,
  ...COMENTARIOS_MUSICAS_CREATE_STATEMENTS,
];

export async function adminRecriarTabelasMusicasD1Controller(): Promise<Response> {
  const db = getCatalogoDb();
  if (!db) {
    return new Response(
      JSON.stringify({ success: false, error: "Binding CATALOGO_DB não disponível neste ambiente." }),
      { status: 500, headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  }

  const executadas: string[] = [];
  const falhas: { statement: string; erro: string }[] = [];

  for (const statement of RECRIAR_STATEMENTS) {
    try {
      await db.prepare(statement).run();
      executadas.push(statement.split("\n")[0].trim());
    } catch (err) {
      falhas.push({
        statement: statement.split("\n")[0].trim(),
        erro: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return new Response(
    JSON.stringify(
      {
        success: falhas.length === 0,
        mensagem:
          falhas.length === 0
            ? "Tabelas 'musicas'/'comentarios_musicas' recriadas com codigo_unico como PK."
            : "Falha ao recriar tabelas.",
        executadas,
        falhas,
      },
      null,
      2,
    ),
    { status: falhas.length === 0 ? 200 : 500, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
}

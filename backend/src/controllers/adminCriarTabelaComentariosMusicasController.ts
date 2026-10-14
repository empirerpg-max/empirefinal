import { getCatalogoDb, COMENTARIOS_MUSICAS_CREATE_STATEMENTS } from "../services/comentariosMusicasDbService";

// Cria (CREATE TABLE IF NOT EXISTS) a tabela dedicada `comentarios_musicas`
// — depende da tabela `musicas` já existir (FK musica_id REFERENCES
// musicas(id)). Idempotente.
export async function adminCriarTabelaComentariosMusicasController(): Promise<Response> {
  const db = getCatalogoDb();
  if (!db) {
    return new Response(
      JSON.stringify({ success: false, error: "Binding CATALOGO_DB não disponível neste ambiente." }),
      { status: 500, headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  }

  const executadas: string[] = [];
  const falhas: { statement: string; erro: string }[] = [];

  for (const statement of COMENTARIOS_MUSICAS_CREATE_STATEMENTS) {
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
            ? "Tabela 'comentarios_musicas' criada/confirmada no D1."
            : "Falha ao criar tabela.",
        executadas,
        falhas,
      },
      null,
      2,
    ),
    { status: falhas.length === 0 ? 200 : 500, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
}

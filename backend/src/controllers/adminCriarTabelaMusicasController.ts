import { getCatalogoDb, MUSICAS_CREATE_STATEMENTS } from "../services/musicasDbService";

// Cria (CREATE TABLE IF NOT EXISTS) a tabela dedicada `musicas` — primeira
// das tabelas por tipo pedidas pelo usuário em 2026-10-14 (uma tabela só
// pra Músicas, outra pra Videos, outra pra Albuns, em vez da `midia`
// genérica compartilhada da Fase 1). Idempotente: pode rodar de novo sem
// erro mesmo se a tabela já existir.
export async function adminCriarTabelaMusicasController(): Promise<Response> {
  const db = getCatalogoDb();
  if (!db) {
    return new Response(
      JSON.stringify({ success: false, error: "Binding CATALOGO_DB não disponível neste ambiente." }),
      { status: 500, headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  }

  const executadas: string[] = [];
  const falhas: { statement: string; erro: string }[] = [];

  for (const statement of MUSICAS_CREATE_STATEMENTS) {
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
        mensagem: falhas.length === 0 ? "Tabela 'musicas' criada/confirmada no D1." : "Falha ao criar tabela.",
        executadas,
        falhas,
      },
      null,
      2,
    ),
    { status: falhas.length === 0 ? 200 : 500, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
}

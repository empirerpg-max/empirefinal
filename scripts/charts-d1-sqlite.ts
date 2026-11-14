// Adaptador D1 → bun:sqlite em memória, pros testes e pra carga local dos
// charts (D1 é SQLite, então o mesmo SQL roda aqui). `batch` roda dentro de
// uma transação: tudo ou nada, igual ao D1.
import { Database } from "bun:sqlite";
import type { D1DatabaseLike, D1PreparedStatement } from "../backend/src/services/catalogoDbService";

type Valor = string | number | bigint | boolean | null | Uint8Array;

export function criarD1Sqlite(arquivo = ":memory:"): D1DatabaseLike {
  const sqlite = new Database(arquivo);

  const executar = (sql: string, params: unknown[]) =>
    sqlite.prepare(sql).all(...(params.map((v) => (v === undefined ? null : v)) as Valor[]));

  const criarStatement = (sql: string, params: unknown[] = []): D1PreparedStatement & { executar(): unknown[] } => ({
    bind: (...values: unknown[]) => criarStatement(sql, values),
    executar: () => executar(sql, params),
    run: async () => {
      executar(sql, params);
      return { results: [], success: true };
    },
    all: async <T>() => ({ results: executar(sql, params) as T[], success: true }),
  });

  return {
    prepare: (sql: string) => criarStatement(sql),
    batch: async (statements: D1PreparedStatement[]) =>
      sqlite.transaction(() =>
        statements.map((s) => ({ results: (s as ReturnType<typeof criarStatement>).executar(), success: true })),
      )(),
  };
}

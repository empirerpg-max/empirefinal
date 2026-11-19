// D1 falso em memória (bun:sqlite) exposto como globalThis.__CATALOGO_DB__,
// mesmo padrão dos testes de espelho existentes.
import { Database } from "bun:sqlite";

export function instalarFakeD1(): Database {
  const sqlite = new Database(":memory:");
  const prep = (sql: string, b: unknown[] = []): any => ({
    bind: (...v: unknown[]) => prep(sql, v),
    run: async () => {
      const r = sqlite.query(sql).run(...(b as never[]));
      return { results: [], success: true, meta: { changes: r.changes, last_row_id: Number(r.lastInsertRowid) } };
    },
    all: async () => ({ results: sqlite.query(sql).all(...(b as never[])), success: true }),
    first: async () => sqlite.query(sql).get(...(b as never[])) ?? null,
  });
  // O D1 real executa um batch por vez (transação serializada); aqui uma fila
  // de promessas imita isso, senão dois batches simultâneos abririam
  // transações aninhadas no SQLite.
  let fila: Promise<unknown> = Promise.resolve();
  const executar = async (st: any[]) => {
      const out = [];
      sqlite.exec("BEGIN");
      try {
        for (const s of st) out.push(await s.run());
        sqlite.exec("COMMIT");
      } catch (e) {
        sqlite.exec("ROLLBACK");
        throw e;
      }
      return out;
  };
  (globalThis as any).__CATALOGO_DB__ = {
    prepare: (s: string) => prep(s),
    batch: (st: any[]) => {
      const p = fila.then(() => executar(st));
      fila = p.catch(() => {});
      return p;
    },
  };
  return sqlite;
}

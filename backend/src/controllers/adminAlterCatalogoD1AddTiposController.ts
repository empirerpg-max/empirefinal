import { getCatalogoDb } from "../services/catalogoDbService";

// Reconciliação de 2026-10-13 (Tarefa 3) — adiciona colunas novas na tabela
// "midia" do D1 de PRODUÇÃO: tipo_single/tipo_musica (rodada música, já
// aplicadas em produção — ficam aqui pra o endpoint continuar idempotente
// se rodado de novo) e reportado_em (rodada vídeo, Gap 2). Mesmo padrão já
// usado na leva de 2026-10-06 (ver comentário em d1/schema.sql):
// ALTER TABLE direto no banco vivo, sem recriar a tabela (D1/SQLite não tem
// DDL transacional nem "IF NOT EXISTS" pra ADD COLUMN antes do SQLite
// 3.37ish — por isso cada ALTER é tentado individualmente e um erro de
// "duplicate column" é tratado como sucesso idempotente, não como falha).
//
// NUNCA chamado automaticamente — só via admin-call.yml (GET), e só depois
// de aprovação explícita do usuário (mudança de schema em produção).
//
// GET /api/empire-play/admin/alter-catalogo-d1-add-tipos
export async function adminAlterCatalogoD1AddTiposController(): Promise<Response> {
  const db = getCatalogoDb();
  if (!db) {
    return new Response(JSON.stringify({ success: false, error: "Binding CATALOGO_DB não disponível." }), {
      status: 500,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  const colunas = [
    { nome: "tipo_single", ddl: "ALTER TABLE midia ADD COLUMN tipo_single TEXT" },
    { nome: "tipo_musica", ddl: "ALTER TABLE midia ADD COLUMN tipo_musica TEXT" },
    { nome: "reportado_em", ddl: "ALTER TABLE midia ADD COLUMN reportado_em TEXT" },
  ];

  const resultado: { coluna: string; status: "criada" | "ja_existia" | "erro"; detalhe?: string }[] = [];

  for (const coluna of colunas) {
    try {
      await db.prepare(coluna.ddl).run();
      resultado.push({ coluna: coluna.nome, status: "criada" });
    } catch (err) {
      const msg = (err as Error).message || String(err);
      // SQLite/D1 reporta coluna já existente como erro de execução, não
      // como um "IF NOT EXISTS" silencioso — idempotente na prática: rodar
      // esse endpoint de novo depois de já ter rodado uma vez não deve
      // contar como falha.
      if (/duplicate column name/i.test(msg)) {
        resultado.push({ coluna: coluna.nome, status: "ja_existia" });
      } else {
        resultado.push({ coluna: coluna.nome, status: "erro", detalhe: msg });
      }
    }
  }

  const sucesso = resultado.every((r) => r.status !== "erro");
  return new Response(JSON.stringify({ success: sucesso, data: resultado }), {
    status: sucesso ? 200 : 500,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

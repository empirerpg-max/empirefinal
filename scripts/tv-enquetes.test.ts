import { test, expect } from "bun:test";
// Enquetes do chat da Empire TV. Uso: bun test scripts/tv-enquetes.test.ts
import { instalarFakeD1 } from "./helpers/fakeD1";
const E = await import("../backend/src/services/tvEnquetes.ts");
const sqlite = instalarFakeD1();
const db = (globalThis as any).__CATALOGO_DB__;
const base = { programaId: "p1", pergunta: "Qual?", tipo: "unica" as const, opcoes: ["A", "B", "C"], secreto: false, soFim: false, encerraEmMs: null, criadaPor: "adm" };

test("apurar: única, múltipla, empate, vazio", () => {
  expect(E.apurar(3, [[0], [0], [1]])).toEqual({ contagem: [2, 1, 0], pct: [67, 33, 0], total: 3, vencedores: [0] });
  expect(E.apurar(2, [[0, 1], [0]])).toMatchObject({ contagem: [2, 1], pct: [100, 50], total: 2, vencedores: [0] });
  expect(E.apurar(2, [[0], [1]]).vencedores).toEqual([0, 1]);
  expect(E.apurar(2, [])).toEqual({ contagem: [0, 0], pct: [0, 0], total: 0, vencedores: [] });
});

test("criarEnquete valida entradas", async () => {
  await expect(E.criarEnquete(db, { ...base, pergunta: "  " }, 1000)).rejects.toThrow();
  await expect(E.criarEnquete(db, { ...base, pergunta: "x".repeat(141) }, 1000)).rejects.toThrow();
  await expect(E.criarEnquete(db, { ...base, opcoes: ["A"] }, 1000)).rejects.toThrow();
  await expect(E.criarEnquete(db, { ...base, opcoes: Array.from({ length: 11 }, (_, i) => "o" + i) }, 1000)).rejects.toThrow();
  await expect(E.criarEnquete(db, { ...base, opcoes: ["A", "a "] }, 1000)).rejects.toThrow();
  await expect(E.criarEnquete(db, { ...base, opcoes: ["A", "x".repeat(61)] }, 1000)).rejects.toThrow();
  await expect(E.criarEnquete(db, { ...base, tipo: "x" as any }, 1000)).rejects.toThrow();
  await expect(E.criarEnquete(db, { ...base, encerraEmMs: 1000 }, 1000)).rejects.toThrow();
  const id = await E.criarEnquete(db, { ...base, pergunta: " Qual? " }, 1000);
  expect(id.length).toBeGreaterThan(10);
});

test("votar: única, múltipla, troca de voto, encerrada", async () => {
  const id = await E.criarEnquete(db, { ...base, programaId: "pv" }, 1000);
  expect(await E.votar(db, "pv", id, "j1", "Ana", [0, 1], 1100)).toBe("invalida");
  expect(await E.votar(db, "pv", id, "j1", "Ana", [], 1100)).toBe("invalida");
  expect(await E.votar(db, "pv", id, "j1", "Ana", [5], 1100)).toBe("invalida");
  expect(await E.votar(db, "pv", "nao-existe", "j1", "Ana", [0], 1100)).toBe("invalida");
  expect(await E.votar(db, "pv", id, "j1", "Ana", [0], 1100)).toBe("ok");
  expect(await E.votar(db, "pv", id, "j1", "Ana", [2], 1200)).toBe("ok");
  const n = sqlite.query("SELECT COUNT(*) c FROM tv_enquete_voto WHERE enquete_id = ?").get(id) as any;
  expect(n.c).toBe(1);
  const m = await E.criarEnquete(db, { ...base, programaId: "pv", tipo: "multipla" }, 1000);
  expect(await E.votar(db, "pv", m, "j1", "Ana", [2, 0, 2], 1100)).toBe("ok");
  expect((sqlite.query("SELECT opcoes FROM tv_enquete_voto WHERE enquete_id = ?").get(m) as any).opcoes).toBe("[0,2]");
  expect(await E.encerrar(db, "pv", id, 1300)).toBe(true);
  expect(await E.encerrar(db, "pv", id, 1400)).toBe(false);
  expect(await E.encerrar(db, "pv", "nada", 1400)).toBe(false);
  expect(await E.votar(db, "pv", id, "j2", "Bia", [0], 1500)).toBe("encerrada");
});

test("votar em enquete vencida fecha e devolve encerrada", async () => {
  const id = await E.criarEnquete(db, { ...base, programaId: "pe", encerraEmMs: 2000 }, 1000);
  expect(await E.votar(db, "pe", id, "j1", "Ana", [0], 2000)).toBe("encerrada");
  expect((sqlite.query("SELECT aberta, encerrada_em FROM tv_enquete WHERE id = ?").get(id) as any)).toEqual({ aberta: 0, encerrada_em: 2000 });
});

test("listarEnquetes: esconde contagem com soFim, fecha vencida, ordena", async () => {
  const a = await E.criarEnquete(db, { ...base, programaId: "pl", soFim: true }, 1000);
  const b = await E.criarEnquete(db, { ...base, programaId: "pl", encerraEmMs: 1500 }, 1100);
  await E.votar(db, "pl", a, "j1", "Ana", [1], 1200);
  await E.votar(db, "pl", b, "j1", "Ana", [0], 1200);
  let l = await E.listarEnquetes(db, "pl", "j1", 1300);
  expect(l.map((x) => x.id)).toEqual([b, a]);
  const la = l.find((x) => x.id === a)!;
  expect(la).toMatchObject({ contagem: null, pct: null, vencedores: [], total: 1, meuVoto: [1], aberta: true, soFim: true });
  l = await E.listarEnquetes(db, "pl", null, 1600);
  const lb = l.find((x) => x.id === b)!;
  expect(lb).toMatchObject({ aberta: false, encerradaEm: 1600, contagem: [1, 0, 0], vencedores: [0], meuVoto: null });
  expect(l[0].id).toBe(a); // aberta primeiro
  await E.encerrar(db, "pl", a, 1700);
  l = await E.listarEnquetes(db, "pl", "j1", 1800);
  expect(l.find((x) => x.id === a)).toMatchObject({ contagem: [0, 1, 0], pct: [0, 100, 0], vencedores: [1] });
});

test("enquete de outro programa nunca é listada, votada nem encerrada", async () => {
  const id = await E.criarEnquete(db, { ...base, programaId: "px" }, 1000);
  expect((await E.listarEnquetes(db, "py", "j1", 1100)).map((x) => x.id)).not.toContain(id);
  expect(await E.votar(db, "py", id, "j1", "Ana", [0], 1100)).toBe("invalida");
  expect(await E.encerrar(db, "py", id, 1100)).toBe(false);
  expect(sqlite.query("SELECT COUNT(*) c FROM tv_enquete_voto WHERE enquete_id = ?").get(id)).toEqual({ c: 0 });
  expect((await E.listarEnquetes(db, "px", "j1", 1100))[0]).toMatchObject({ id, aberta: true });
});

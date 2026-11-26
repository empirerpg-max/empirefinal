import { test, expect } from "bun:test";
// Coletor de minutos da presença na Empire TV (lado do app). Puro: o tempo é injetado.
// Uso: bun test scripts/tv-presenca-cliente.test.ts
const { ColetorMinutos } = await import("../src/lib/tvPresencaCliente.ts");
const M = (h: number, m: number, s = 0) => Date.UTC(2026, 10, 26, h, m, s);

test("duas marcas no mesmo minuto viram uma só pendente", () => {
  const c = new ColetorMinutos();
  c.marcar(M(20, 0, 5));
  c.marcar(M(20, 0, 50));
  expect(c.pendentes(M(20, 0, 55)).idades.length).toBe(1);
});

test("pendentes devolve as idades (agora - marca) em ms", () => {
  const c = new ColetorMinutos();
  c.marcar(M(20, 0, 10));
  c.marcar(M(20, 1, 10));
  c.marcar(M(20, 2, 10));
  expect(c.pendentes(M(20, 3, 0)).idades).toEqual([170_000, 110_000, 50_000]);
});

test("sem confirmar, pendentes continua devolvendo as mesmas marcas (reenvio)", () => {
  const c = new ColetorMinutos();
  c.marcar(M(20, 0));
  c.marcar(M(20, 1));
  const agora = M(20, 2);
  expect(c.pendentes(agora).idades).toEqual([120_000, 60_000]);
  expect(c.pendentes(agora).idades).toEqual([120_000, 60_000]);
  c.marcar(M(20, 2, 30));
  expect(c.pendentes(M(20, 3)).idades).toEqual([180_000, 120_000, 30_000]);
});

test("depois de confirmar o lote, fica vazio; marcas novas voltam a acumular", () => {
  const c = new ColetorMinutos();
  c.marcar(M(20, 0));
  c.marcar(M(20, 1));
  const lote = c.pendentes(M(20, 2));
  c.confirmar(lote);
  expect(c.pendentes(M(20, 2)).idades).toEqual([]);
  expect(c.vazio()).toBe(true);
  c.marcar(M(20, 2, 1));
  expect(c.pendentes(M(20, 3)).idades).toEqual([59_000]);
});

test("confirmar só limpa o lote enviado (marca nova durante o envio fica)", () => {
  const c = new ColetorMinutos();
  c.marcar(M(20, 0));
  const lote = c.pendentes(M(20, 1)); // lido para envio
  c.marcar(M(20, 1, 5)); // chega durante o envio
  c.confirmar(lote);
  expect(c.pendentes(M(20, 2)).idades).toEqual([55_000]);
});

test("dois lotes sobrepostos: o 1º falha e o 2º (que o contém) dá certo → nada pendente", () => {
  // lote 1 = {0,1}; chega a marca 2; lote 2 = {0,1,2}
  const c = new ColetorMinutos();
  c.marcar(M(20, 0));
  c.marcar(M(20, 1));
  const l1 = c.pendentes(M(20, 1, 30));
  c.marcar(M(20, 2));
  const l2 = c.pendentes(M(20, 2, 30));
  c.confirmar(l2); // 2º ok; 1º falhou (nunca confirmado)
  expect(c.pendentes(M(20, 3)).idades).toEqual([]);
  expect(l1.minutos.length).toBe(2);
});

test("dois lotes: o 2º (lido depois) dá certo e o 1º falha → minutos só do 1º continuam pendentes", () => {
  // O 2º lote não contém o minuto do 1º (lote montado só com o minuto novo).
  const c = new ColetorMinutos();
  c.marcar(M(20, 0));
  const l1 = c.pendentes(M(20, 0, 30)); // {0}
  c.marcar(M(20, 1));
  // 2º lote só com o minuto 1 (ex.: lote montado com subconjunto)
  const l2 = { minutos: [Math.floor(M(20, 1) / 60000)], idades: [0] };
  c.confirmar(l2);
  expect(c.pendentes(M(20, 2)).idades).toEqual([120_000]); // minuto 0, só do 1º lote (que falhou)
  // o 1º lote é reenviado e confirmado depois (ex.: envio de saída que voltou ok)
  c.confirmar(l1);
  expect(c.vazio()).toBe(true);
});

test("o 1º lote dá certo e o 2º (com mais minutos) falha → só os minutos extras do 2º ficam", () => {
  const c = new ColetorMinutos();
  c.marcar(M(20, 0));
  const l1 = c.pendentes(M(20, 0, 30)); // {0}
  c.marcar(M(20, 1));
  const l2 = c.pendentes(M(20, 1, 30)); // {0,1} — falha
  c.confirmar(l1);
  expect(c.pendentes(M(20, 2)).idades).toEqual([60_000]);
  expect(l2.minutos.length).toBe(2);
});

test("lote de saída confirmado depois que a sala foi fechada (ida e volta pelo armazenamento)", () => {
  const c = new ColetorMinutos();
  c.marcar(M(20, 0));
  c.marcar(M(20, 1));
  const saida = c.pendentes(M(20, 2));
  const restaurado = ColetorMinutos.de(JSON.parse(JSON.stringify(c.exportar())));
  expect(restaurado.pendentes(M(20, 2)).idades).toEqual([120_000, 60_000]);
  restaurado.confirmar(saida);
  expect(restaurado.vazio()).toBe(true);
  expect(ColetorMinutos.de(["x", null, 5] as unknown[]).pendentes(10).idades).toEqual([5]);
});

test("marcas com mais de 6 h caem e o lote nunca passa de 400", () => {
  const c = new ColetorMinutos();
  for (let k = 0; k < 500; k++) c.marcar(M(10, 0) + k * 60_000);
  const agora = M(10, 0) + 500 * 60_000;
  const p = c.pendentes(agora).idades;
  expect(p.length).toBeLessThanOrEqual(400);
  expect(Math.max(...p)).toBeLessThanOrEqual(6 * 3600_000);
  expect(Math.min(...p)).toBe(60_000);
});

// ---------- marcas guardadas têm dono (jogador logado quando marcou) ----------
const { chavePendente, lerPendentesGuardados, gravarPendentesGuardados, entradasParaEnviar } = await import(
  "../src/lib/tvPresencaCliente.ts"
);

test("entradas de outro jogador nunca são devolvidas para envio", () => {
  const a = new ColetorMinutos();
  a.marcar(M(20, 0));
  const b = new ColetorMinutos();
  b.marcar(M(20, 1));
  const mapa = new Map([
    [chavePendente("A", "p1"), { dono: "A", programaId: "p1", coletor: a }],
    [chavePendente("B", "p1"), { dono: "B", programaId: "p1", coletor: b }],
  ]);
  expect(entradasParaEnviar(mapa, "B").map((e) => e.dono)).toEqual(["B"]);
  expect(entradasParaEnviar(mapa, "A").map((e) => e.coletor)).toEqual([a]);
  expect(entradasParaEnviar(mapa, null)).toEqual([]);
  expect(entradasParaEnviar(mapa, "")).toEqual([]);
});

test("ao restaurar do armazenamento, entradas de outro dono (ou sem dono) caem", () => {
  const a = new ColetorMinutos();
  a.marcar(M(20, 0));
  const b = new ColetorMinutos();
  b.marcar(M(20, 1));
  const guardado = JSON.parse(
    JSON.stringify(
      gravarPendentesGuardados(
        new Map([
          [chavePendente("A", "p1"), { dono: "A", programaId: "p1", coletor: a }],
          [chavePendente("B", "p2"), { dono: "B", programaId: "p2", coletor: b }],
        ]),
      ),
    ),
  );
  const soB = lerPendentesGuardados({ ...guardado, lixo: { programaId: "p3", instantes: [M(20, 2)] } }, "B");
  expect([...soB.values()].map((e) => [e.dono, e.programaId])).toEqual([["B", "p2"]]);
  expect(soB.get(chavePendente("B", "p2"))!.coletor.pendentes(M(20, 2)).idades).toEqual([60_000]);
  expect(lerPendentesGuardados(guardado, null).size).toBe(0);
  expect(lerPendentesGuardados("x", "A").size).toBe(0);
  // formato antigo (sem dono) cai
  expect(lerPendentesGuardados({ p1: [M(20, 0)] }, "A").size).toBe(0);
});

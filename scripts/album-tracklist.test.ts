import { test, expect } from "bun:test";
// Tracklist de álbum (Albuns!M): reordenar pela tela e mesclar faixas novas
// (funções puras). Uso: bun test scripts/album-tracklist.test.ts
const { reordenarTracklist, mesclarTracklist } = await import(
  "../backend/src/controllers/albumTracklist.ts"
);

const e = (titulo: string, ordem: number, disco = 1) => ({ titulo, disco, ordem });

test("reordenar segue a ordem da tela e deduplica", () => {
  const atual = [e("A - Toast", 1), e("A - Utopia", 1), e("A - Mani", 2), e("A - Toast", 5)];
  expect(reordenarTracklist(atual, ["A - Utopia", "A - Mani", "A - Toast"])).toEqual([
    e("A - Utopia", 1),
    e("A - Mani", 2),
    e("A - Toast", 3),
  ]);
});

test("órfã vai pro fim, preservada", () => {
  const atual = [e("A - X", 1), e("A - Immobilier", 2), e("A - Y", 3)];
  expect(reordenarTracklist(atual, ["A - Y", "A - X"])).toEqual([
    e("A - Y", 1),
    e("A - X", 2),
    e("A - Immobilier", 3),
  ]);
});

test("multi-disco reinicia ordem e mantém o disco de cada faixa", () => {
  const atual = [e("A - a", 1, 1), e("A - b", 2, 1), e("A - c", 1, 2), e("A - d", 2, 2)];
  expect(reordenarTracklist(atual, ["A - b", "A - a", "A - d", "A - c"])).toEqual([
    e("A - b", 1, 1),
    e("A - a", 2, 1),
    e("A - d", 1, 2),
    e("A - c", 2, 2),
  ]);
});

test("tracklist vazia vira disco 1 na ordem da tela", () => {
  expect(reordenarTracklist([], ["A - b", "A - a"])).toEqual([e("A - b", 1), e("A - a", 2)]);
});

test("comparação de título ignora caixa/espaços e mantém o título da tela", () => {
  expect(reordenarTracklist([e(" a - x ", 1)], ["A - X"])).toEqual([e("A - X", 1)]);
});

test("mesclar não duplica título existente e põe novo no fim do disco", () => {
  const atual = [e("A - a", 1), e("A - b", 2)];
  expect(mesclarTracklist(atual, [e("A - b", 1), e("A - c", 1)])).toEqual([
    e("A - a", 1),
    e("A - b", 2),
    e("A - c", 3),
  ]);
});

test("mesclar respeita o disco da faixa nova", () => {
  expect(mesclarTracklist([e("A - a", 1, 1), e("A - z", 1, 2)], [e("A - n", 1, 2)])).toEqual([
    e("A - a", 1, 1),
    e("A - z", 1, 2),
    e("A - n", 2, 2),
  ]);
});

// planejarReordenacao: linhas = Musicas!H..U lidas de H1 (índice rowIndex-1;
// coluna 0 = H, coluna 13 = U).
const { planejarReordenacao } = await import("../backend/src/controllers/albumTracklist.ts");
const linha = (h: string, u: string) => {
  const r = Array(14).fill("");
  r[0] = h;
  r[13] = u;
  return r;
};
const linhas = [linha("Titulo", "Ordem"), linha("A - x", "1"), linha("A - y", "2"), linha("A - z", "3")];

test("planejar grava U só das faixas cuja ordem mudou", () => {
  const plano = planejarReordenacao(
    [
      { musicaRowIndex: 3, ordem: 1 },
      { musicaRowIndex: 2, ordem: 2 },
      { musicaRowIndex: 4, ordem: 3 },
    ],
    linhas,
    [e("A - x", 1), e("A - y", 2), e("A - z", 3)],
  );
  expect(plano.escritasU).toEqual([
    { musicaRowIndex: 3, ordem: 1 },
    { musicaRowIndex: 2, ordem: 2 },
  ]);
  expect(plano.tracklistNova).toEqual([e("A - y", 1), e("A - x", 2), e("A - z", 3)]);
});

test("planejar NÃO cria tracklist em álbum antigo (M vazia)", () => {
  const plano = planejarReordenacao(
    [
      { musicaRowIndex: 3, ordem: 1 },
      { musicaRowIndex: 2, ordem: 2 },
    ],
    linhas,
    [],
  );
  expect(plano.tracklistNova).toBeNull();
  expect(plano.escritasU.length).toBe(2);
});

test("planejar recusa título vazio quando há tracklist", () => {
  expect(() =>
    planejarReordenacao([{ musicaRowIndex: 9, ordem: 1 }], linhas, [e("A - x", 1)]),
  ).toThrow();
});

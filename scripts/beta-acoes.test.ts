import { describe, expect, test } from "bun:test";
import { ordenarAcoes, type AcaoMenu } from "../src/lib/acoesMenu";

const acao = (id: string, destrutiva?: boolean): AcaoMenu => ({
  id,
  rotulo: id,
  destrutiva,
  aoEscolher: () => {},
});

const ids = (l: AcaoMenu[]) => l.map((a) => a.id);

describe("ordenarAcoes", () => {
  test("lista vazia devolve lista vazia", () => {
    expect(ordenarAcoes([])).toEqual([]);
  });

  test("sem destrutivas mantém a ordem dada", () => {
    expect(ids(ordenarAcoes([acao("a"), acao("b"), acao("c")]))).toEqual(["a", "b", "c"]);
  });

  test("destrutivas vão para o fim", () => {
    expect(ids(ordenarAcoes([acao("x", true), acao("a"), acao("b")]))).toEqual(["a", "b", "x"]);
  });

  test("é estável nos dois grupos", () => {
    const entrada = [acao("x", true), acao("a"), acao("y", true), acao("b"), acao("c", false), acao("z", true)];
    expect(ids(ordenarAcoes(entrada))).toEqual(["a", "b", "c", "x", "y", "z"]);
  });

  test("não altera a lista recebida", () => {
    const entrada = [acao("x", true), acao("a")];
    ordenarAcoes(entrada);
    expect(ids(entrada)).toEqual(["x", "a"]);
  });
});

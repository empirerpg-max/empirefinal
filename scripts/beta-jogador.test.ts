import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { jogadorAtual } from "../src/lib/jogador";
import type { LoginResult } from "../src/components/LoginScreen";

const LOGIN: LoginResult = {
  id: "123",
  nome: "João",
  usuario: "Joao",
  tipoPerfil: "Jogador",
  fotoPerfil: "",
  prestigio: "",
};

describe("jogadorAtual", () => {
  test("login salvo vem primeiro (mesmo com id do useTelegramUser)", () => {
    expect(jogadorAtual(LOGIN, "999")).toEqual({ id: "123", usuario: "Joao", tipoPerfil: "Jogador" });
  });

  test("sem login, usa o id do useTelegramUser (compatibilidade)", () => {
    expect(jogadorAtual(null, "555")).toEqual({ id: "555", usuario: "" });
  });

  test("sem nada → null", () => {
    expect(jogadorAtual(null)).toBeNull();
    expect(jogadorAtual(null, "")).toBeNull();
  });

  test("visitante (\"guest\") não é jogador", () => {
    expect(jogadorAtual(null, "guest")).toBeNull();
  });

  test("login sem id cai no id do useTelegramUser", () => {
    expect(jogadorAtual({ ...LOGIN, id: "" }, "555")).toEqual({ id: "555", usuario: "" });
  });
});

// O id histórico de admin só pode existir em LoginScreen.tsx (critério único
// isAdminLogin). Vale para comentários também, para não voltar aos poucos.
describe("id fixo de admin fora de LoginScreen.tsx", () => {
  const ID = ["810", "141", "686"].join("");
  const RAIZ = join(import.meta.dir, "..", "src");
  const PERMITIDO = join("components", "LoginScreen.tsx");

  function listar(dir: string): string[] {
    const saida: string[] = [];
    for (const nome of readdirSync(dir)) {
      const caminho = join(dir, nome);
      if (statSync(caminho).isDirectory()) saida.push(...listar(caminho));
      else saida.push(caminho);
    }
    return saida;
  }

  test("nenhum arquivo de src/ (fora LoginScreen.tsx) contém o id", () => {
    const achados = listar(RAIZ)
      .filter((f) => relative(RAIZ, f) !== PERMITIDO)
      .filter((f) => readFileSync(f, "utf8").includes(ID))
      .map((f) => relative(RAIZ, f));
    expect(achados).toEqual([]);
  });

  test("LoginScreen.tsx continua com o id (critério único)", () => {
    expect(readFileSync(join(RAIZ, PERMITIDO), "utf8")).toContain(ID);
  });
});

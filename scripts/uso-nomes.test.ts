import { describe, expect, test } from "bun:test";
import { intervaloDoPeriodo, nomeDaAcao, nomeDaTela, nomeDoCaminho } from "../src/lib/uso/nomes";

describe("nomeDaAcao", () => {
  test("ações conhecidas", () => {
    expect(nomeDaAcao("/api/forum/comment")).toBe("Comentar no Fórum");
    expect(nomeDaAcao("/api/social/posts")).toBe("Postar no Social");
    expect(nomeDaAcao("/api/social/curtir")).toBe("Curtir post");
    expect(nomeDaAcao("/api/ponto/:id")).toBe("Ponto");
    expect(nomeDaAcao("/api/gestao/faixa/publicar")).toBe("Publicar faixa");
    expect(nomeDaAcao("tocar_musica")).toBe("Tocar música");
    expect(nomeDaAcao("buscar")).toBe("Buscar");
  });
  test("desconhecida mostra o caminho", () => {
    expect(nomeDaAcao("/api/social/posts/:id/deletar")).toBe("/api/social/posts/:id/deletar");
  });
});

describe("nomeDaTela / nomeDoCaminho", () => {
  test("telas", () => {
    expect(nomeDaTela("/")).toBe("Início");
    expect(nomeDaTela("/charts")).toBe("/charts");
    expect(nomeDaTela("/artistas/$nome/")).toBe("/artistas/$nome");
    expect(nomeDaTela("/social › Feed")).toBe("/social › Feed");
    expect(nomeDaTela("/ › Destaques")).toBe("Início › Destaques");
  });
  test("caminhos", () => {
    expect(nomeDoCaminho("/api/forum/comment ← /forum/")).toBe("Comentar no Fórum ← /forum");
    expect(nomeDoCaminho("tocar_musica ← /")).toBe("Tocar música ← Início");
  });
});

describe("intervaloDoPeriodo (dias UTC)", () => {
  const agora = new Date("2026-11-27T23:30:00Z");
  test("esta semana = 7 dias com hoje", () => {
    expect(intervaloDoPeriodo("semana", agora)).toEqual({ de: "2026-11-21", ate: "2026-11-27" });
  });
  test("semana anterior = os 7 antes", () => {
    expect(intervaloDoPeriodo("anterior", agora)).toEqual({ de: "2026-11-14", ate: "2026-11-20" });
  });
  test("últimos 30 dias, atravessando mês", () => {
    expect(intervaloDoPeriodo("30dias", new Date("2026-03-05T01:00:00Z"))).toEqual({ de: "2026-02-04", ate: "2026-03-05" });
  });
});

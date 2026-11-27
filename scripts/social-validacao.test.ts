import { test, expect } from "bun:test";
// Validação do conteúdo de post do Social (legenda opcional quando há mídia).
// Uso: bun test scripts/social-validacao.test.ts
const V = await import("../backend/src/services/socialValidacao.ts");

test("story/feed só com imagem e sem legenda é aceito", () => {
  expect(V.postTemConteudo({ texto: "", media_url: "https://x/img.jpg" })).toBe(true);
  expect(V.postTemConteudo({ texto: "   ", media_url: "https://x/v.mp4" })).toBe(true);
});
test("post com material (música/álbum) e sem legenda é aceito", () => {
  expect(V.postTemConteudo({ texto: "", material: { tipo: "musica" } })).toBe(true);
});
test("post só com texto é aceito; vazio sem mídia é recusado", () => {
  expect(V.postTemConteudo({ texto: "oi" })).toBe(true);
  expect(V.postTemConteudo({ texto: "  " })).toBe(false);
  expect(V.postTemConteudo({})).toBe(false);
  expect(V.postTemConteudo({ texto: "", media_url: "   " })).toBe(false);
});

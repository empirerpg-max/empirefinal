import { test, expect } from "bun:test";
// Sala da Empire TV ativa: adiar recarga automática + sala no endereço.
// Uso: bun test scripts/tv-sala-ativa.test.ts
const S = await import("../src/lib/salaAtiva.ts");

test("deveAdiarRecarga: adia se digitando OU com a sala aberta em tela cheia", () => {
  // `sala` = sala em tela cheia na rota /tv (só mini player não adia).
  expect(S.deveAdiarRecarga(false, false)).toBe(false);
  expect(S.deveAdiarRecarga(true, false)).toBe(true);
  expect(S.deveAdiarRecarga(false, true)).toBe(true);
  expect(S.deveAdiarRecarga(true, true)).toBe(true);
});

test("marcarSalaAtiva / salaAtiva guardam o estado (sala em tela cheia)", () => {
  S.marcarSalaAtiva(false);
  expect(S.salaAtiva()).toBe(false);
  S.marcarSalaAtiva(true);
  expect(S.salaAtiva()).toBe(true);
  S.marcarSalaAtiva(false);
  expect(S.salaAtiva()).toBe(false);
});

test("aoSairDaSala: avisa só quando a sala sai da tela cheia (fechou, minimizou ou trocou de tela)", () => {
  S.marcarSalaAtiva(false);
  let chamadas = 0;
  const sair = S.aoSairDaSala(() => chamadas++);
  S.marcarSalaAtiva(false); // já estava inativa
  expect(chamadas).toBe(0);
  S.marcarSalaAtiva(true);
  S.marcarSalaAtiva(true);
  expect(chamadas).toBe(0);
  S.marcarSalaAtiva(false);
  expect(chamadas).toBe(1);
  sair();
  S.marcarSalaAtiva(true);
  S.marcarSalaAtiva(false);
  expect(chamadas).toBe(1);
});

test("adiarAteSairDaSala: um aviso só, recarrega uma vez ao sair", () => {
  S.marcarSalaAtiva(true);
  const avisos: string[] = [];
  let recargas = 0;
  const toastFn = (titulo: string) => avisos.push(titulo);
  S.adiarAteSairDaSala(() => recargas++, toastFn);
  S.adiarAteSairDaSala(() => recargas++, toastFn);
  expect(avisos).toEqual(["Nova versão disponível — atualiza quando você sair da sala"]);
  expect(recargas).toBe(0);
  S.marcarSalaAtiva(false);
  expect(recargas).toBe(1);
  S.marcarSalaAtiva(true);
  S.marcarSalaAtiva(false);
  expect(recargas).toBe(1);
});

test("adiarAteSairDaSala: 'Atualizar agora' recarrega na hora", () => {
  S.marcarSalaAtiva(true);
  let acao: (() => void) | undefined;
  let recargas = 0;
  S.adiarAteSairDaSala(() => recargas++, (_t, opts) => { acao = opts?.action?.onClick; });
  expect(typeof acao).toBe("function");
  acao!();
  expect(recargas).toBe(1);
  S.marcarSalaAtiva(false); // não recarrega de novo
  expect(recargas).toBe(1);
});

test("salaDaUrl: lê o parâmetro sala, ignora vazio", () => {
  expect(S.salaDaUrl("?sala=abc")).toBe("abc");
  expect(S.salaDaUrl("sala=abc")).toBe("abc");
  expect(S.salaDaUrl("?x=1&sala=123")).toBe("123");
  expect(S.salaDaUrl("?sala=")).toBe(null);
  expect(S.salaDaUrl("?sala=%20")).toBe(null);
  expect(S.salaDaUrl("")).toBe(null);
  expect(S.salaDaUrl("?outra=1")).toBe(null);
  // O roteador grava números entre aspas (JSON) — volta ao id cru.
  expect(S.salaDaUrl("?sala=%22123%22")).toBe("123");
});

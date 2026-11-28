// Pedido de token do Google com limite de tempo (28/11: sem limite, um token
// pendurado prendia a aba inteira no isolate, igual a leitura pendurada).
import { test, expect, beforeAll, afterAll } from "bun:test";

const R = new URL("../backend/src/", import.meta.url).pathname;
// "?real": no `bun test scripts/` (um processo só), outro arquivo troca este
// módulo com mock.module; o sufixo carrega o arquivo de verdade.
const sa = await import(R + "google/service-account.ts?real");

const fetchOriginal = globalThis.fetch;
const credOriginal = process.env.GOOGLE_SHEETS_CREDENTIALS;

beforeAll(async () => {
  // Chave RSA de mentira só para o JWT ser assinado (nada sai daqui).
  const par = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", par.privateKey));
  const b64 = btoa(String.fromCharCode(...pkcs8));
  const pem = `-----BEGIN PRIVATE KEY-----\n${b64}\n-----END PRIVATE KEY-----`;
  process.env.GOOGLE_SHEETS_CREDENTIALS = JSON.stringify({
    client_email: "teste@exemplo.invalid",
    private_key: pem,
    token_uri: "https://token.exemplo.invalid/token",
  });
  // Token que nunca responde (só rejeita se o signal abortar, como o fetch real).
  (globalThis as any).fetch = (_url: string, init: any) =>
    new Promise<Response>((_, rej) => {
      const s: AbortSignal | undefined = init?.signal;
      if (s) s.addEventListener("abort", () => rej(s.reason), { once: true });
    });
  sa.__definirLimiteTokenParaTeste(30);
});

afterAll(() => {
  globalThis.fetch = fetchOriginal;
  if (credOriginal === undefined) delete process.env.GOOGLE_SHEETS_CREDENTIALS;
  else process.env.GOOGLE_SHEETS_CREDENTIALS = credOriginal;
  sa.__definirLimiteTokenParaTeste(10_000);
});

test("token que pendura rejeita com a mensagem de 10 s", async () => {
  await expect(sa.getGoogleAccessToken(["escopo-teste"])).rejects.toThrow(
    "Google (token) não respondeu em 10 s",
  );
});

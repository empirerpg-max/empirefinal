// Leituras do Google com limite de tempo (28/11: uma leitura da aba
// `usuarios` ficou pendurada ~45 min e, pelo `readInFlight`, prendeu todo
// pedido seguinte da mesma aba no isolate). Escritas NUNCA têm limite.
import { test, expect, beforeEach, beforeAll, afterAll, mock, spyOn } from "bun:test";

const R = new URL("../backend/src/", import.meta.url).pathname;
mock.module(R + "google/service-account.ts", () => ({
  getGoogleAccessToken: async () => "tok",
  getDriveOAuthAccessToken: async () => "tok",
  readRuntimeEnv: () => "",
}));
mock.module(R + "services/logSistemaService.ts", () => ({
  registrarLogSistema: async () => {},
  traduzirErroEscrita: () => ({ causaProvavel: "", comoResolver: "" }),
}));

const svc = await import(R + "services/googleSheetsService.ts");

type Chamada = { url: string; init: any };
let chamadas: Chamada[] = [];
// "pendurar": nunca responde (só rejeita se o signal abortar, como o fetch real).
let modo: "pendurar" | "ok" = "pendurar";

const pendurar = (init: any) =>
  new Promise<Response>((_, rej) => {
    const s: AbortSignal | undefined = init?.signal;
    if (s) s.addEventListener("abort", () => rej(s.reason), { once: true });
  });

(globalThis as any).fetch = async (url: string, init: any) => {
  chamadas.push({ url: String(url), init });
  const metodo = init?.method ?? "GET";
  if (metodo !== "GET") {
    // Escrita que demora um pouco (mais que o limite de teste) mas responde.
    await new Promise((r) => setTimeout(r, 80));
    return new Response("{}", { status: 200 });
  }
  if (modo === "pendurar") return pendurar(init);
  if (String(url).includes("/gviz/")) return new Response("a,b\n1,2\n", { status: 200 });
  return new Response(JSON.stringify({ values: [["a"], ["1"]] }), { status: 200 });
};

// Silencia os avisos/erros esperados do serviço durante os testes.
let espioErro: ReturnType<typeof spyOn>;
let espioAviso: ReturnType<typeof spyOn>;
beforeAll(() => {
  espioErro = spyOn(console, "error").mockImplementation(() => {});
  espioAviso = spyOn(console, "warn").mockImplementation(() => {});
});
afterAll(() => {
  espioErro.mockRestore();
  espioAviso.mockRestore();
  // Volta os limites ao padrão de produção.
  svc.__definirLimitesDeTempoParaTeste({ leituraSheetsMs: 20_000, gvizMs: 10_000 });
});

beforeEach(() => {
  chamadas = [];
  modo = "pendurar";
  // Tempos curtos só no teste (padrão de produção continua 20 s / 10 s).
  svc.__definirLimitesDeTempoParaTeste({ leituraSheetsMs: 30, gvizMs: 30 });
});

test("leitura GET que nunca responde rejeita com a mensagem de 20 s", async () => {
  await expect(svc.listSheetTabs("planilha-x")).rejects.toThrow(
    "Google Sheets não respondeu em 20 s",
  );
});

test("GViz que nunca responde rejeita com a mensagem de 10 s", async () => {
  await expect(svc.fetchGVizCsv("planilha-x", "usuarios")).rejects.toThrow(
    "GViz CSV não respondeu em 10 s",
  );
});

test("POST (escrita) não recebe signal de limite de tempo", async () => {
  await svc.spreadsheetBatchUpdate("planilha-x", [{ x: 1 }]);
  const post = chamadas.find((c) => c.init?.method === "POST");
  expect(post).toBeDefined();
  expect(post!.init.signal).toBeUndefined();
});

test("depois de um timeout, a próxima leitura da mesma aba faz um fetch novo", async () => {
  const p1 = svc.googleDireto.readValues("planilha-y", "usuarios");
  const p2 = svc.googleDireto.readValues("planilha-y", "usuarios"); // junta no readInFlight
  const [r1, r2] = await Promise.allSettled([p1, p2]);
  expect(r1.status).toBe("rejected");
  expect(r2.status).toBe("rejected");
  expect((r1 as PromiseRejectedResult).reason.message).toBe("GViz CSV não respondeu em 10 s");
  expect((r2 as PromiseRejectedResult).reason.message).toBe("GViz CSV não respondeu em 10 s");
  // Juntou no readInFlight: uma chamada v4 + uma GViz só, não duas de cada.
  expect(chamadas.length).toBe(2);
  const antes = chamadas.length;
  modo = "ok";
  const linhas = await svc.googleDireto.readValues("planilha-y", "usuarios");
  expect(linhas).toEqual([["a"], ["1"]]);
  expect(chamadas.length).toBeGreaterThan(antes);
});

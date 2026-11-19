import { test, expect, beforeEach, mock } from "bun:test";
import { instalarFakeD1 } from "./helpers/fakeD1";

const R = new URL("../backend/src/", import.meta.url).pathname;
mock.module(R + "google/service-account.ts", () => ({
  getGoogleAccessToken: async () => "tok",
  getDriveOAuthAccessToken: async () => "tok-drive",
  readRuntimeEnv: () => "",
}));
mock.module(R + "services/sessionService.ts", () => ({
  extractBearerToken: (r: Request) => r.headers.get("Authorization")?.replace(/^Bearer /, "") ?? null,
  verifySessionToken: async (t: string | null) => (t === "valido" ? { usuario: "Jogador", id: "123" } : null),
  requestProvesAdmin: async () => false,
}));
mock.module(R + "services/logSistemaService.ts", () => ({
  registrarLogSistema: async () => {},
  traduzirErroEscrita: () => ({ causaProvavel: "", comoResolver: "" }),
}));

type Chamada = { url: string; method: string; headers: Record<string, string>; body: any };
let chamadas: Chamada[] = [];
let criadoHa = 10 * 60 * 1000;
(globalThis as any).fetch = async (url: string, init: any = {}) => {
  const headers = Object.fromEntries(new Headers(init.headers || {}).entries());
  chamadas.push({ url: String(url), method: init.method || "GET", headers, body: init.body ? JSON.parse(init.body) : null });
  if (String(url).includes("uploadType=resumable")) {
    return new Response(null, { status: 200, headers: { Location: "https://upload.googleapis.com/sessao-x" } });
  }
  if (String(url).includes("fields=createdTime")) {
    return new Response(JSON.stringify({ createdTime: new Date(Date.now() - criadoHa).toISOString(), parents: ["1Jk9Jk-Zd6QAoZnW3nAqFhBiJCNAnw3wR"] }), { status: 200 });
  }
  if (String(url).includes("fields=parents,trashed")) {
    return new Response(JSON.stringify({ parents: ["1Jk9Jk-Zd6QAoZnW3nAqFhBiJCNAnw3wR"], trashed: false }), { status: 200 });
  }
  return new Response("{}", { status: 200 });
};
const kv = new Map<string, string>();
(globalThis as any).__FLAGS_KV__ = { get: async (k: string) => kv.get(k) ?? null, put: async (k: string, v: string) => void kv.set(k, v) };

const { PLANILHA_VIRTUAL_CREATE_STATEMENTS, substituirAba } = await import(R + "services/planilhaVirtualD1.ts");
const { definirEstadoAba, PLANILHA_PRINCIPAL_ID: P } = await import(R + "services/porteiroD1.ts");
const C = await import(R + "controllers/videoUploadSessaoController.ts");
const FILE = "1AbCdEfGhIjKlMnOpQrStUvWxYz012345";

const req = (body: unknown, origin = "https://app.exemplo", token = "valido") =>
  new Request("https://worker.exemplo/api/gestao/video-upload-sessao", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin, Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });

beforeEach(async () => {
  const sqlite = instalarFakeD1();
  for (const s of PLANILHA_VIRTUAL_CREATE_STATEMENTS) sqlite.exec(s);
  chamadas = [];
  criadoHa = 10 * 60 * 1000;
  for (const aba of ["Music Videos", "VIDEOS_PENDENTES_EMPIRE_TV"]) await definirEstadoAba(aba, "on");
  const db = (globalThis as any).__CATALOGO_DB__;
  await db.batch(await substituirAba(P, "Music Videos", [["Título", "Link do vídeo"], ["Outro", "https://drive.google.com/file/d/1ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ/view"]]));
  await db.batch(await substituirAba(P, "VIDEOS_PENDENTES_EMPIRE_TV", [["ID"]]));
});

test("sessão: pede ao Drive com pasta de vídeos e Origin, devolve Location", async () => {
  const res = await C.criarSessaoUploadVideoController(req({ fileName: "clipe.mp4", mimeType: "video/mp4", size: 157286400 }));
  expect(await res.json()).toEqual({ success: true, uploadUrl: "https://upload.googleapis.com/sessao-x" });
  const c = chamadas.find((x) => x.url.includes("uploadType=resumable"))!;
  expect(c.method).toBe("POST");
  expect(c.body).toEqual({ name: "clipe.mp4", parents: ["1Jk9Jk-Zd6QAoZnW3nAqFhBiJCNAnw3wR"] });
  expect(c.headers.origin).toBe("https://app.exemplo");
  expect(c.headers["x-upload-content-type"]).toBe("video/mp4");
  expect(c.headers["x-upload-content-length"]).toBe("157286400");
  expect(c.headers.authorization).toBe("Bearer tok-drive");
});

test("sessão recusa arquivo que não é vídeo e arquivo acima de 5 GB", async () => {
  expect((await C.criarSessaoUploadVideoController(req({ fileName: "a.png", mimeType: "image/png", size: 10 }))).status).toBe(400);
  expect((await C.criarSessaoUploadVideoController(req({ fileName: "a.mp4", mimeType: "video/mp4", size: 6 * 1024 ** 3 }))).status).toBe(400);
  expect(chamadas).toEqual([]);
});

const reqDescartar = (fileId: string, token = "valido") =>
  new Request("https://worker.exemplo/api/gestao/video-upload-descartar", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ fileId }),
  });

test("I6: sem login válido, sessão e descarte são recusados (401) sem tocar no Drive", async () => {
  expect((await C.criarSessaoUploadVideoController(req({ fileName: "a.mp4", mimeType: "video/mp4", size: 10 }, "https://app.exemplo", "falso"))).status).toBe(401);
  expect((await C.descartarUploadVideoController(reqDescartar(FILE, "falso"))).status).toBe(401);
  expect(chamadas).toEqual([]);
});

test("descarte manda para a lixeira arquivo recente e sem uso", async () => {
  const res = await C.descartarUploadVideoController(reqDescartar(FILE));
  expect(await res.json()).toEqual({ success: true, descartado: true });
  const patch = chamadas.find((x) => x.method === "PATCH")!;
  expect(patch.url).toContain(FILE);
  expect(patch.body).toEqual({ trashed: true });
});

test("descarte recusa arquivo já usado no catálogo ou na fila da TV", async () => {
  const db = (globalThis as any).__CATALOGO_DB__;
  await db.batch(await substituirAba(P, "VIDEOS_PENDENTES_EMPIRE_TV", [["ID"], ["VIDEOPEND-1", `{"mediaUrl":"https://drive.google.com/file/d/${FILE}/view"}`]]));
  expect(await (await C.descartarUploadVideoController(reqDescartar(FILE))).json()).toEqual({ success: true, descartado: false, motivo: "em-uso" });
  expect(chamadas.some((x) => x.method === "PATCH")).toBe(false);
});

test("descarte recusa arquivo antigo (mais de 2 h)", async () => {
  criadoHa = 3 * 60 * 60 * 1000;
  expect(await (await C.descartarUploadVideoController(reqDescartar(FILE))).json()).toEqual({ success: true, descartado: false, motivo: "antigo" });
  expect(chamadas.some((x) => x.method === "PATCH")).toBe(false);
});

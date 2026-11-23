import { test, expect, mock } from "bun:test";
// As rotas novas precisam passar pela lista de caminhos aceitos do roteador
// (supportedPaths em backend/src/routes/api.ts), senão viram 404.
const R = new URL("../backend/src/", import.meta.url).pathname;
mock.module(R + "google/service-account.ts", () => ({
  getGoogleAccessToken: async () => "tok",
  getDriveOAuthAccessToken: async () => "tok",
  readRuntimeEnv: () => "",
}));
const { handleEmpireApiRoutes } = await import(R + "routes/api.ts");

const chamar = (path: string, method = "POST") =>
  handleEmpireApiRoutes(new Request(`https://w.exemplo${path}`, { method, body: method === "POST" ? "{}" : undefined }));

test("rotas de admin do D1 primeiro existem e exigem admin", async () => {
  for (const [p, m] of [
    ["/api/admin/d1primeiro/status", "GET"],
    ["/api/admin/d1primeiro/carregar", "POST"],
    ["/api/admin/fila-backup/despachar", "POST"],
  ] as const) {
    const res = await chamar(p, m);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
  }
});

test("rotas de upload direto de vídeo existem", async () => {
  const sessao = await chamar("/api/gestao/video-upload-sessao");
  expect(sessao).not.toBeNull();
  expect(sessao!.status).toBe(401); // sem login
  const descartar = await chamar("/api/gestao/video-upload-descartar");
  expect(descartar).not.toBeNull();
  expect(descartar!.status).toBe(401);
});

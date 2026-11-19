import { test, expect, mock } from "bun:test";
import { instalarFakeD1 } from "./helpers/fakeD1";
// Revisão I7: dois envios "Lançar em um programa dessa semana?" ao mesmo
// tempo não podem cair na mesma linha da fila (um apagaria o outro).
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
(globalThis as any).fetch = async () => {
  throw new Error("não deveria chamar o Google");
};
instalarFakeD1();
const { definirEstadoAba } = await import(R + "services/porteiroD1.ts");
const G = await import(R + "services/googleSheetsService.ts");
const { criarVideoPendenteEmpireTvController } = await import(R + "controllers/gestaoEmpireTvController.ts");

const envio = (titulo: string) =>
  new Request("https://w.exemplo/api/gestao/video-empire-tv-pendente", {
    method: "POST",
    body: JSON.stringify({ tituloVideo: titulo, artistaResponsavel: "Angela", nomeJogador: "J", dataPrograma: "2026-11-20", categoriaVideo: "Performance" }),
  });

test("cinco envios simultâneos ficam todos na fila da Empire TV", async () => {
  await definirEstadoAba("VIDEOS_PENDENTES_EMPIRE_TV", "on");
  await G.updateValues("principal", "VIDEOS_PENDENTES_EMPIRE_TV", "A1:I1", [["ID", "JogadorId", "JogadorNome", "Artista", "Categoria", "Titulo", "DataPrograma", "CriadoEmISO", "PayloadJson"]]);
  const nomes = ["Um", "Dois", "Tres", "Quatro", "Cinco"];
  const respostas = await Promise.all(nomes.map((n) => criarVideoPendenteEmpireTvController(envio(n))));
  for (const r of respostas) expect((await r.json()).success).toBe(true);
  const linhas = await G.readValues("principal", "VIDEOS_PENDENTES_EMPIRE_TV");
  expect(linhas.slice(1).map((l) => l[5]).sort()).toEqual(nomes.map((n) => `Angela - ${n}`).sort());
});

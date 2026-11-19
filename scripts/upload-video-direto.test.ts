import { test, expect, beforeEach } from "bun:test";

let sessoes = 0;
let falhasRestantes = 0;
let puts: { url: string; tipo: string | null; tamanho: number }[] = [];
(globalThis as any).fetch = async (url: string, init: any) => {
  if (String(url) === "/api/gestao/video-upload-sessao") {
    sessoes++;
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ mimeType: "video/mp4", size: 1000 });
    return new Response(JSON.stringify({ success: true, uploadUrl: `https://upload.googleapis.com/s${sessoes}` }));
  }
  throw new Error("fetch inesperado " + url);
};

class FakeXHR {
  upload: { onprogress: ((e: any) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  status = 0;
  responseText = "";
  private url = "";
  private headers: Record<string, string> = {};
  open(_m: string, url: string) { this.url = url; }
  setRequestHeader(k: string, v: string) { this.headers[k] = v; }
  send(blob: Blob) {
    puts.push({ url: this.url, tipo: this.headers["Content-Type"] ?? null, tamanho: blob.size });
    queueMicrotask(() => {
      if (falhasRestantes > 0) { falhasRestantes--; this.onerror?.(); return; }
      this.upload.onprogress?.({ lengthComputable: true, loaded: 500, total: 1000 });
      this.upload.onprogress?.({ lengthComputable: true, loaded: 1000, total: 1000 });
      this.status = 200;
      this.responseText = JSON.stringify({ id: "1AbCdEfGhIjKlMnOpQrStUvWxYz012345" });
      this.onload?.();
    });
  }
}
(globalThis as any).XMLHttpRequest = FakeXHR;

const { uploadVideoDireto } = await import("../src/lib/uploadVideoDireto");
const arquivo = () => new File([new Uint8Array(1000)], "clipe.mp4", { type: "video/mp4" });

beforeEach(() => { sessoes = 0; falhasRestantes = 0; puts = []; });

test("envia direto para a sessão do Google e devolve o link do Drive, com progresso", async () => {
  const progresso: number[] = [];
  const link = await uploadVideoDireto(arquivo(), "VIDEO_teste", (p) => progresso.push(p));
  expect(link).toBe("https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/view?usp=drivesdk");
  expect(puts).toEqual([{ url: "https://upload.googleapis.com/s1", tipo: "video/mp4", tamanho: 1000 }]);
  expect(progresso).toEqual([50, 100]);
});

test("falha de rede: tenta de novo com sessão nova, até 2 vezes", async () => {
  falhasRestantes = 2;
  await uploadVideoDireto(arquivo(), "VIDEO_teste", () => {});
  expect(sessoes).toBe(3);
  expect(puts.map((p) => p.url)).toEqual(["https://upload.googleapis.com/s1", "https://upload.googleapis.com/s2", "https://upload.googleapis.com/s3"]);
});

test("desiste depois de 3 tentativas com mensagem clara", async () => {
  falhasRestantes = 5;
  await expect(uploadVideoDireto(arquivo(), "VIDEO_teste", () => {})).rejects.toThrow("Não foi possível enviar o vídeo");
  expect(sessoes).toBe(3);
});

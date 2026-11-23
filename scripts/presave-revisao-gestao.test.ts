import { test, expect, beforeEach } from "bun:test";
import { instalarFakeD1 } from "./helpers/fakeD1";
// Achados da revisão final nas funções REAIS de gestaoController que o motor
// do pre-save chama: nenhuma leitura que decide "o quê/onde gravar" pode usar
// readValues (cache + fallback GViz, que devolve a aba inteira com cabeçalho e
// pula linhas vazias). Uso: bun test scripts/presave-revisao-gestao.test.ts
instalarFakeD1();
const { googleSheetsService } = await import("../backend/src/services/googleSheetsService.ts");
const G = await import("../backend/src/controllers/gestaoController.ts");
// Antes de qualquer substituição de teste: as 3 planilhas que o motor usa
// precisam ter leitura fresca de verdade (o tsc pegou que só "principal" tinha).
const temFresh = (["principal", "edicaoCharts", "registrosCharts"] as const).map(
  (p) => typeof (googleSheetsService as any)[p].readValuesFresh === "function",
);
test("as três planilhas do lançamento têm readValuesFresh", () => {
  expect(temFresh).toEqual([true, true, true]);
});

type Planilha = "principal" | "edicaoCharts" | "registrosCharts";
const escritas: { planilha: Planilha; aba: string; range: string; values: unknown[][] }[] = [];
let fresh: (p: Planilha, aba: string, range?: string) => string[][] = () => [];
let updateOk = true;
let leiturasFresh = 0;

beforeEach(() => {
  escritas.length = 0;
  updateOk = true;
  leiturasFresh = 0;
  for (const p of ["principal", "edicaoCharts", "registrosCharts"] as Planilha[]) {
    const s = (googleSheetsService as any)[p];
    s.readValues = async () => { throw new Error(`readValues (GViz) usado em ${p}`); };
    s.readValuesFresh = async (aba: string, range?: string) => { leiturasFresh++; return fresh(p, aba, range); };
    s.updateValues = async (aba: string, range: string, values: unknown[][]) => {
      escritas.push({ planilha: p, aba, range, values });
      return updateOk;
    };
    s.ensureRowCapacity = async () => {};
  }
});

/** EDIÇÃO CHARTS ÁLBUMS com cabeçalho + uma linha por código (D = nome, R = código), respeitando a linha inicial do range. */
function eca(range: string | undefined, codigos: string[]): string[][] {
  const cab = Array(18).fill("cab"); cab[17] = "Código único";
  const rows = [cab, ...codigos.map((c, i) => { const r = Array(18).fill(""); r[3] = `Album ${i}`; r[17] = c; return r; })];
  const inicio = Number(range?.match(/^[A-Z]+(\d+)/)?.[1] || 1);
  return rows.slice(inicio - 1);
}

test("lerCodigoUnicoGerado lê fresh", async () => {
  fresh = () => [["EMP123"]];
  expect(await G.lerCodigoUnicoGerado(124)).toBe("EMP123");
});

test("mirrorMusicaRowParaD1 lê fresh", async () => {
  const row = Array(26).fill(""); row[7] = "Jessica Johnson - Shipbait"; row[13] = "Jessica Johnson"; row[25] = "EMP1052";
  fresh = () => [row];
  // sem a tabela `musicas` o upsert falha e devolve false — o que importa é ler fresh
  await G.mirrorMusicaRowParaD1(899).catch(() => false);
  expect(leiturasFresh).toBeGreaterThan(0);
});

test("registrarNaEdicaoCharts calcula a linha com leitura fresh", async () => {
  fresh = () => [["x", "Musica A"], ["x", ""], ["x", "Musica B"]]; // A2:B — B na linha 4
  const linha = await G.registrarNaEdicaoCharts({ dataFormatada: "22/11/2026", fullTitle: "J - X", tipoSingle: "T", tipoMusica: "S", album: "J - A", artistaPrincipal: "J" });
  expect(linha).toBe(5);
});

test("gravarLinhaAlbumEmAlbuns calcula a linha com leitura fresh", async () => {
  fresh = () => [["d", "t", "", "", "", "", "Album 1"]];
  const linha = await G.gravarLinhaAlbumEmAlbuns({ dataFormatada: "d", albumTopicId: "t2", capaUrl: "", jogadorId: "", nomeJogador: "n", albumFullTitle: "J - A", encartesStr: "", tipoAlbum: "Álbum" });
  expect(linha).toBe(3);
});

test("registrarNoRegistroDeMusica lê a fila fresh", async () => {
  fresh = () => [["", "Título"], ["", "ocupada"]];
  await G.registrarNoRegistroDeMusica({ songTitle: "J - X", tipoSingle: "T", tipoMusica: "S", album: "J - A", artistaPrincipal: "J", participantes: [] });
  expect(escritas[0].range).toBe("B3:P3");
});

test("registrarAlbumNaEdicaoChartsAlbuns lê fresh e copia o código para Albuns!L", async () => {
  fresh = (_p, aba, range) => (aba === "EDIÇÃO CHARTS ÁLBUMS" ? eca(range, ["EMPALBM097", "EMPALBM098"]) : []);
  const codigo = await G.registrarAlbumNaEdicaoChartsAlbuns({ artistaAlbum: "J", albumFullTitle: "J - A", tipoAlbum: "Álbum", dataFormatada: "d", numeroSemanas: 1, numeroFaixas: 12, albumRowIndexEmAlbuns: 110 });
  expect(codigo).toBe("EMPALBM099");
  expect(escritas.find((e) => e.aba === "EDIÇÃO CHARTS ÁLBUMS")!.range).toBe("A4:R4");
  expect(escritas.find((e) => e.aba === "Albuns")!.range).toBe("L110");
});

test("registrarAlbumNaEdicaoChartsAlbuns lê fresh e, se a escrita falha, não devolve código nem copia para Albuns!L", async () => {
  fresh = (_p, aba, range) => (aba === "EDIÇÃO CHARTS ÁLBUMS" ? eca(range, ["EMPALBM098"]) : []);
  updateOk = false;
  const codigo = await G.registrarAlbumNaEdicaoChartsAlbuns({ artistaAlbum: "J", albumFullTitle: "J - A", tipoAlbum: "Álbum", dataFormatada: "d", numeroSemanas: 1, numeroFaixas: 12, albumRowIndexEmAlbuns: 109 });
  expect(codigo).toBe("");
  expect(escritas.some((e) => e.aba === "Albuns")).toBe(false);
});

test("registrarAlbumNaEdicaoChartsAlbuns: leitura que falha não inventa código (EMPALBM001 já existe)", async () => {
  fresh = (_p, aba, range) => {
    if (range === "A1:BZ5000") throw new Error("429 quota");
    return aba === "EDIÇÃO CHARTS ÁLBUMS" ? eca(range, ["EMPALBM098"]) : [];
  };
  const codigo = await G.registrarAlbumNaEdicaoChartsAlbuns({ artistaAlbum: "J", albumFullTitle: "J - A", tipoAlbum: "Álbum", dataFormatada: "d", numeroSemanas: 1, numeroFaixas: 12, albumRowIndexEmAlbuns: 110 });
  expect(codigo).toBe("");
  expect(escritas.length).toBe(0);
});

test("completarAlbumExistente recusa (409) faixa inédita com título que já existe no álbum", async () => {
  const albuns = [["Data", "ID", "", "", "", "", "Nome"], ["d", "album_x", "", "", "", "", "Jessica Johnson - Bad Behavior"]];
  const musica = Array(26).fill(""); musica[7] = "Jessica Johnson - Pretty Woman"; musica[10] = "Jessica Johnson - Bad Behavior";
  fresh = (_p, aba) => (aba === "Albuns" ? albuns : aba === "Musicas" ? [Array(26).fill(""), musica] : []);
  (googleSheetsService as any).principal.readValues = async (aba: string) => (aba === "Albuns" ? albuns : []);
  let erro: any = null;
  await G.completarAlbumExistente({
    albumTopicId: "album_x", nomeJogador: "daniel", jogadorId: "1",
    novasFaixas: [{ num: 1, inedita: true, titulo: "Pretty Woman" }],
  } as any).catch((e) => { erro = e; });
  expect(erro?.status).toBe(409);
  expect(String(erro?.message)).toContain("Pretty Woman");
  expect(escritas.filter((e) => e.aba === "Musicas").length).toBe(0);
});

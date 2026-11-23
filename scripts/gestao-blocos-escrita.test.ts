import { test, expect } from "bun:test";
// Blocos de escrita extraídos de gestaoController.ts (reaproveitados pelo
// pre-save em passos). Uso: bun test scripts/gestao-blocos-escrita.test.ts
const G = await import("../backend/src/controllers/gestaoController.ts");

const base = {
  dataFormatada: "22/11/2026",
  artistaAlbum: "Jessica Johnson",
  albumFullTitle: "Jessica Johnson - Bad Behavior",
  capaUrl: "https://drive/capa",
  jogadorId: "7701082951",
};

test("faixa inédita pendente (Shipbait) monta as 24 colunas de Musicas", () => {
  const r = G.montarLinhaMusicasFaixaInedita({
    ...base,
    trackTopicId: "",
    faixa: { num: 6, inedita: true, titulo: "Shipbait", participantes: ["Samantha Cooper"], mediaUrl: "https://drive/6", letra: "l", abrirTopico: false },
  });
  expect(r.songTitle).toBe("Jessica Johnson - Shipbait");
  expect(r.pendente).toBe(true);
  expect(r.linha.length).toBe(24);
  expect(r.linha[0]).toBe("22/11/2026");
  expect(r.linha[2]).toBe("https://drive/6");
  expect(r.linha[3]).toBe("https://drive/capa");
  expect(r.linha[6]).toBe("7701082951");
  expect(r.linha[7]).toBe("Jessica Johnson - Shipbait");
  expect(r.linha[8]).toBe("TRACKLIST ALBUM");
  expect(r.linha[9]).toBe("SOLO");
  expect(r.linha[10]).toBe("Jessica Johnson - Bad Behavior");
  expect(r.linha[13]).toBe("Jessica Johnson");
  expect(r.linha[14]).toBe("Samantha Cooper");
  expect(r.linha[20]).toBe("6");
  expect(r.linha[23]).toBe("Sim");
});

test("faixa com tópico próprio grava o id em B e F e não fica pendente", () => {
  const r = G.montarLinhaMusicasFaixaInedita({
    ...base,
    trackTopicId: "musica_x",
    faixa: { num: 12, inedita: true, titulo: "Bad Behavior", abrirTopico: true },
  });
  expect(r.linha[1]).toBe("musica_x");
  expect(r.linha[5]).toBe("musica_x");
  expect(r.linha[23]).toBe("Não");
  expect(r.pendente).toBe(false);
});

test("título já com prefixo do artista não duplica", () => {
  const r = G.montarLinhaMusicasFaixaInedita({ ...base, trackTopicId: "", faixa: { num: 1, inedita: true, titulo: "Jessica Johnson - Pretty Woman" } });
  expect(r.songTitle).toBe("Jessica Johnson - Pretty Woman");
});

test("exporta os blocos usados pelo pre-save", () => {
  for (const nome of ["appendRowMusicasSeguro", "registrarNoRegistroDeMusica", "registrarInfosMusicas", "gravarLinhaAlbumEmAlbuns"]) {
    expect(typeof (G as Record<string, unknown>)[nome]).toBe("function");
  }
});

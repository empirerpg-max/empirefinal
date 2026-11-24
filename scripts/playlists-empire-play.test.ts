import { test, expect } from "bun:test";
// Playlists do Empire Play: ids e catálogo tocável. Uso: bun test scripts/playlists-empire-play.test.ts
import {
  parseIdPlaylist,
  formatarIdPlaylist,
  montarCatalogoTocavel,
  ligarFaixa,
  carregarCatalogoTocavel,
  limparCachePlaylists,
  montarPlaylist,
  carregarHot,
  type CatalogoTocavel,
  type FontesPlaylists,
} from "../backend/src/services/playlistsEmpirePlay";
import type { EmpirePlayCleanItem } from "../backend/src/controllers/empirePlayController";
import { criarD1Sqlite } from "./charts-d1-sqlite";
import { MUSICAS_CREATE_STATEMENTS } from "../backend/src/services/musicasDbService";
import { VIDEOS_CREATE_STATEMENTS } from "../backend/src/services/videosDbService";
import { CHARTS_D1_SCHEMA } from "../backend/src/services/chartsD1/repo";

type MusicaTeste = { titulo: string; artista: string; codigo_unico?: string; audioUrl?: string; coverUrl?: string; genero?: string; tipoSingle?: string };
type ClipeTeste = { titulo: string; codigo_unico?: string; tipo_video: string; videoUrl?: string; thumb?: string };

/** Monta um CatalogoTocavel a partir de itens já no formato EmpirePlayCleanItem. */
function catalogoDeTeste(musicas: MusicaTeste[], clipes: ClipeTeste[], fotos?: Map<string, string>): CatalogoTocavel {
  const m: EmpirePlayCleanItem[] = musicas.map((x) => ({
    // id estável como o real (tópico/código), nunca a posição na lista
    id: `musicas_${x.codigo_unico || x.audioUrl || x.titulo}`,
    type: "musicas",
    title: x.titulo,
    artist: x.artista,
    ...(x.codigo_unico ? { codigoUnico: x.codigo_unico } : {}),
    ...(x.audioUrl ? { audioUrl: x.audioUrl } : {}),
    ...(x.coverUrl ? { coverUrl: x.coverUrl } : {}),
    ...(x.genero ? { genero: x.genero } : {}),
    ...(x.tipoSingle ? { tipoSingle: x.tipoSingle } : {}),
  }));
  const c: EmpirePlayCleanItem[] = clipes.map((x) => ({
    id: `videos_${x.videoUrl || x.titulo}`,
    type: "videos",
    title: x.titulo,
    artist: "Artista",
    category: x.tipo_video,
    ...(x.codigo_unico ? { codigoUnico: x.codigo_unico } : {}),
    ...(x.videoUrl ? { videoUrl: x.videoUrl } : {}),
    ...(x.thumb ? { coverUrl: x.thumb } : {}),
  }));
  return montarCatalogoTocavel(m, c, fotos);
}

test("ids de playlist: ida e volta; inválidos dão null", () => {
  for (const id of ["ao-vivo:spotify", "pais:youtube:REINO UNIDO", "semana:global100", "semana:parada:UK", "semana:genero:POP", "semana:hot"])
    expect(formatarIdPlaylist(parseIdPlaylist(id)!)).toBe(id);
  expect(parseIdPlaylist("pais:tiktok:BRASIL")).toBeNull();
  expect(parseIdPlaylist("qualquer")).toBeNull();
});

test("ids de playlist: país e gênero sem diferença de caixa/acento; vazios e sobras dão null", () => {
  expect(parseIdPlaylist("pais:apple:austrália")).toEqual({ tipo: "pais", plataforma: "apple", pais: "AUSTRÁLIA" });
  expect(parseIdPlaylist("semana:genero:Música Pop")).toEqual({ tipo: "genero", genero: "MUSICA POP" });
  expect(parseIdPlaylist(formatarIdPlaylist({ tipo: "genero", genero: "pop" }))).toEqual({ tipo: "genero", genero: "POP" });
  for (const ruim of ["", "ao-vivo:", "ao-vivo:spotify:x", "pais:spotify", "pais:spotify:", "semana:parada:", "semana:genero:", "semana:hot:x", "semana:global100:x", "semana:outro"])
    expect(parseIdPlaylist(ruim)).toBeNull();
});

test("ligarFaixa: casa música e clipe pelo código único; sem catálogo fica não tocável", () => {
  const cat = catalogoDeTeste([
    { titulo: "Sweet Spot", artista: "Jessica Johnson", codigo_unico: "EMP1", audioUrl: "a.mp3", coverUrl: "c.jpg" },
  ], [{ titulo: "Sweet Spot (Clipe)", codigo_unico: "EMP1", tipo_video: "Music Video", videoUrl: "v.mp4", thumb: "t.jpg" }]);
  const f = ligarFaixa(cat, "Jessica Johnson - Sweet Spot", 1, "187.049.605");
  expect(f).toMatchObject({ chave: "EMP1", tocavel: true, capa_url: "c.jpg" });
  expect(f.clipe?.videoUrl ?? f.clipe).toBeTruthy();
  const g = ligarFaixa(cat, "Ninguém - Inexistente", 2, "10");
  expect(g).toMatchObject({ tocavel: false, musica: null, clipe: null, pos: 2 });
});

test("ligarFaixa: detalhes — sem áudio, sem código, clipe que não é Music Video, capa pela foto, single vence álbum", () => {
  const fotos = new Map([["RAYNA", "rayna.jpg"], ["NINGUÉM", "ninguem.jpg"]]);
  const cat = catalogoDeTeste(
    [
      { titulo: "Shapeshifter", artista: "Rayna", codigo_unico: "EMP2" }, // sem áudio e sem capa
      { titulo: "Sem Codigo", artista: "Rayna", audioUrl: "s.mp3" },
      { titulo: "Bastarda", artista: "TED", codigo_unico: "ALB1", audioUrl: "alb.mp3", tipoSingle: "Tracklist Album" },
      { titulo: "Bastarda", artista: "TED", codigo_unico: "SGL1", audioUrl: "sgl.mp3", tipoSingle: "Single" },
    ],
    [
      { titulo: "Shapeshifter (Live)", codigo_unico: "EMP2", tipo_video: "Live", videoUrl: "live.mp4" },
      { titulo: "Bastarda (Clipe)", codigo_unico: "SGL1", tipo_video: "music video", videoUrl: "b.mp4" },
    ],
    fotos,
  );
  const a = ligarFaixa(cat, "Rayna - Shapeshifter", 3, "5");
  expect(a).toMatchObject({ chave: "EMP2", tocavel: false, clipe: null, capa_url: "rayna.jpg", titulo: "Shapeshifter", artista: "Rayna", valor: "5" });
  expect(a.musica?.codigoUnico).toBe("EMP2");
  const b = ligarFaixa(cat, "Rayna - Sem Codigo", 4, "1");
  expect(b.chave).toBe("rayna - sem codigo");
  expect(b.tocavel).toBe(true);
  const c = ligarFaixa(cat, "TED - Bastarda", 5, "1");
  expect(c).toMatchObject({ chave: "SGL1", tocavel: true });
  expect(c.clipe?.videoUrl).toBe("b.mp4");
  const d = ligarFaixa(cat, "Ninguém - Inexistente", 6, "1");
  expect(d).toMatchObject({ chave: "ninguem - inexistente", titulo: "Inexistente", artista: "Ninguém", capa_url: "ninguem.jpg" });
  // mesma entrada → mesma saída
  expect(ligarFaixa(cat, "TED - Bastarda", 5, "1")).toEqual(c);
});

test("carregarCatalogoTocavel: lê só o D1 (musicas, Music Videos, fotos), cache de 15 min, sem D1 → vazio", async () => {
  const g = globalThis as Record<string, unknown>;
  const antes = g.__CATALOGO_DB__;
  const consultas: string[] = [];
  try {
    limparCachePlaylists();
    g.__CATALOGO_DB__ = undefined;
    const vazio = await carregarCatalogoTocavel();
    expect(ligarFaixa(vazio, "Jessica Johnson - Sweet Spot", 1, "1").tocavel).toBe(false);

    limparCachePlaylists();
    const db = criarD1Sqlite(":memory:", (sql) => consultas.push(sql));
    for (const s of [...MUSICAS_CREATE_STATEMENTS, ...VIDEOS_CREATE_STATEMENTS, ...CHARTS_D1_SCHEMA]) db.exec(s);
    db.exec(`INSERT INTO musicas (chave, codigo_unico, id_topico, titulo, artista, capa_url, audio_url, genero, pendente)
      VALUES ('k1', 'EMP1', '77', 'Sweet Spot', 'Jessica Johnson', 'c.jpg', 'a.mp3', 'Pop', 0),
             ('k2', 'EMP9', NULL, 'Escondida', 'Jessica Johnson', NULL, 'p.mp3', 'Pop', 1)`);
    db.exec(`INSERT INTO videos (id_topico, titulo_topico, tipo_video, link_video, thumb_url, codigo_unico, linha_planilha)
      VALUES ('900', 'Jessica Johnson - Sweet Spot', 'Music Video', 'https://youtu.be/abc', 't.jpg', 'EMP1', 2),
             ('901', 'Jessica Johnson - Sweet Spot (Live)', 'Live', 'https://youtu.be/live', 't2.jpg', 'EMP1', 3),
             ('902', 'Jessica Johnson - Outra', 'music video ', 'https://youtu.be/outra', 't3.jpg', 'EMP3', 4)`);
    db.exec(`INSERT INTO musicas (chave, codigo_unico, titulo, artista, audio_url, pendente)
      VALUES ('k3', 'EMP3', 'Outra', 'Jessica Johnson', 'o.mp3', 0)`);
    db.exec(`INSERT INTO artista_info (nome_upper, nome, foto) VALUES ('JESSICA JOHNSON', 'Jessica Johnson', 'jj.jpg')`);
    g.__CATALOGO_DB__ = db;

    const cat = await carregarCatalogoTocavel();
    const f = ligarFaixa(cat, "Jessica Johnson - Sweet Spot", 1, "1");
    expect(f).toMatchObject({ chave: "EMP1", tocavel: true, capa_url: "c.jpg" });
    expect(f.musica).toMatchObject({ id: "musicas_77", title: "Sweet Spot", audioUrl: "a.mp3", genero: "Pop" });
    expect(f.clipe).toMatchObject({ title: "Sweet Spot", category: "Music Video", codigoUnico: "EMP1" });
    expect(f.clipe?.videoUrl).toBeTruthy();
    // "music video " (caixa/espaço diferentes) também entra
    expect(ligarFaixa(cat, "Jessica Johnson - Outra", 3, "1").clipe).toMatchObject({ codigoUnico: "EMP3", title: "Outra" });
    // faixa pendente nunca entra (mesma regra de /api/empire-play/musicas)
    expect(ligarFaixa(cat, "Jessica Johnson - Escondida", 2, "1")).toMatchObject({ musica: null, capa_url: "jj.jpg" });

    const n = consultas.length;
    expect(await carregarCatalogoTocavel()).toBe(cat);
    expect(consultas.length).toBe(n);
    // só lê Music Videos (filtro no SQL), nada de escrita
    expect(consultas.some((s) => /FROM videos/i.test(s) && /tipo_video/i.test(s))).toBe(true);
    expect(consultas.every((s) => /^\s*SELECT/i.test(s))).toBe(true);
  } finally {
    g.__CATALOGO_DB__ = antes;
    limparCachePlaylists();
  }
});

test("carregarCatalogoTocavel: falha do D1 não fica em cache", async () => {
  const g = globalThis as Record<string, unknown>;
  const antes = g.__CATALOGO_DB__;
  try {
    limparCachePlaylists();
    let quebrado = true;
    const db = criarD1Sqlite();
    for (const s of [...MUSICAS_CREATE_STATEMENTS, ...VIDEOS_CREATE_STATEMENTS, ...CHARTS_D1_SCHEMA]) db.exec(s);
    g.__CATALOGO_DB__ = {
      prepare: (sql: string) => {
        if (quebrado) throw new Error("D1 fora do ar");
        return db.prepare(sql);
      },
      batch: db.batch,
    };
    await expect(carregarCatalogoTocavel()).rejects.toThrow();
    quebrado = false;
    const cat = await carregarCatalogoTocavel();
    expect(ligarFaixa(cat, "A - B", 1, "1").tocavel).toBe(false);
  } finally {
    g.__CATALOGO_DB__ = antes;
    limparCachePlaylists();
  }
});

test("montarCatalogoTocavel: entrada embaralhada dá o mesmo resultado (empates não dependem da ordem do D1)", () => {
  const musicas: MusicaTeste[] = [
    { titulo: "Igual", artista: "A", codigo_unico: "X2", audioUrl: "x2.mp3", coverUrl: "x2.jpg" },
    { titulo: "Igual", artista: "A", codigo_unico: "X1", audioUrl: "x1.mp3", coverUrl: "x1.jpg" },
    { titulo: "Sem Codigo", artista: "B", audioUrl: "b1.mp3" },
    { titulo: "Sem Codigo", artista: "B", audioUrl: "b2.mp3" },
    { titulo: "Outra", artista: "C", codigo_unico: "C1", audioUrl: "c.mp3" },
  ];
  const clipes: ClipeTeste[] = [
    { titulo: "Clipe 2", codigo_unico: "X1", tipo_video: "Music Video", videoUrl: "v2.mp4" },
    { titulo: "Clipe 1", codigo_unico: "X1", tipo_video: "Music Video", videoUrl: "v1.mp4" },
    { titulo: "Clipe C", codigo_unico: "C1", tipo_video: "Music Video", videoUrl: "vc.mp4" },
  ];
  const titulos = ["A - Igual", "B - Sem Codigo", "C - Outra", "Igual"];
  const ligar = (m: MusicaTeste[], c: ClipeTeste[]) => {
    const cat = catalogoDeTeste(m, c);
    return titulos.map((t, i) => {
      const f = ligarFaixa(cat, t, i + 1, "1");
      return { chave: f.chave, audio: f.musica?.audioUrl, capa: f.capa_url, clipe: f.clipe?.videoUrl };
    });
  };
  const base = ligar(musicas, clipes);
  expect(base[0]).toMatchObject({ chave: "X1", clipe: "v1.mp4" });
  for (const ordem of [[4, 3, 2, 1, 0], [2, 0, 4, 1, 3], [1, 4, 0, 3, 2]]) {
    const m = ordem.map((i) => musicas[i]);
    const c = ordem.filter((i) => i < clipes.length).map((i) => clipes[i]);
    expect(ligar(m, c)).toEqual(base);
  }
});

// ---- Montar cada playlist (fontes falsas) ----

const vazioPlat = () => ({ spotify: [], apple: [], youtube: [] });

function fontesFalsas(over: Partial<{ [K in keyof FontesPlaylists]: Awaited<ReturnType<FontesPlaylists[K]>> }>): FontesPlaylists {
  const cat = over.catalogo ?? catalogoDeTeste([], []);
  return {
    emAlta: async () => over.emAlta ?? vazioPlat(),
    aoVivoPaises: async () => over.aoVivoPaises ?? vazioPlat(),
    semana: async () => over.semana ?? { global100: [], paradas: [] },
    hot: async () => over.hot ?? [],
    catalogo: async () => cat,
  };
}

const CAT_PLAYLISTS = catalogoDeTeste([
  { titulo: "Sweet Spot", artista: "Jessica Johnson", codigo_unico: "EMP1", audioUrl: "a.mp3", coverUrl: "sweet.jpg", genero: "Pop" },
  { titulo: "Shapeshifter", artista: "Rayna", codigo_unico: "EMP2", audioUrl: "s.mp3", coverUrl: "shape.jpg", genero: "POP" },
  { titulo: "Bastarda", artista: "TED", codigo_unico: "EMP3", audioUrl: "b.mp3", coverUrl: "bast.jpg", genero: "Rap" },
  { titulo: "Follia", artista: "Brida", codigo_unico: "EMP4", audioUrl: "f.mp3", coverUrl: "follia.jpg", genero: "pop" },
], []);

test("montarPlaylist ao-vivo: ordem da EM Alta, valor cheio formatado, capa = capa da #1", async () => {
  const fontes = fontesFalsas({
    catalogo: CAT_PLAYLISTS,
    emAlta: {
      ...vazioPlat(),
      spotify: [
        { t: "Rayna - Shapeshifter", n: 187049605, s: "187.049.605", p: "", c: "" },
        { t: "Ninguém - Inexistente", n: 5000, s: "5.000", p: "", c: "" },
        { t: "Jessica Johnson - Sweet Spot", n: 1200, s: "1.200", p: "", c: "" },
      ],
    },
  });
  const p = await montarPlaylist({ tipo: "ao-vivo", plataforma: "spotify" }, fontes);
  expect(p).toMatchObject({
    id: "ao-vivo:spotify",
    titulo: "Top 100 Spotify Global",
    subtitulo: "Ao vivo · atualiza a cada 30 s",
    plataforma: "spotify",
    aoVivo: true,
    capa_url: "shape.jpg",
  });
  expect(p!.faixas.map((f) => [f.pos, f.titulo, f.valor, f.tocavel])).toEqual([
    [1, "Shapeshifter", "187.049.605", true],
    [2, "Inexistente", "5.000", false],
    [3, "Sweet Spot", "1.200", true],
  ]);
  expect(p!.faixas[1]).toMatchObject({ musica: null, chave: "ninguem - inexistente" });
  expect((await montarPlaylist({ tipo: "ao-vivo", plataforma: "apple" }, fontes))!.titulo).toBe("Top 100 Apple Music");
  const yt = await montarPlaylist({ tipo: "ao-vivo", plataforma: "youtube" }, fontes);
  expect(yt).toMatchObject({ titulo: "Top 100 YouTube Hits", faixas: [], capa_url: null });
  // mesmo instante → mesma resposta
  expect(await montarPlaylist({ tipo: "ao-vivo", plataforma: "spotify" }, fontes)).toEqual(p);
});

test("montarPlaylist ao-vivo: no máximo 100 faixas", async () => {
  const spotify = Array.from({ length: 130 }, (_, i) => ({ t: `A${i} - M${i}`, n: 1000 - i, s: "", p: "", c: "" }));
  const p = await montarPlaylist({ tipo: "ao-vivo", plataforma: "spotify" }, fontesFalsas({ emAlta: { ...vazioPlat(), spotify } }));
  expect(p!.faixas.length).toBe(100);
  expect(p!.faixas[99].pos).toBe(100);
});

test("montarPlaylist país: só as linhas do país (sem diferença de acento), título em Título, país inexistente → null", async () => {
  const linha = (pais: string, pos: number, t: string, s: string) => ({ pais, pos, t, s, c: "", art: "" });
  const fontes = fontesFalsas({
    catalogo: CAT_PLAYLISTS,
    aoVivoPaises: {
      ...vazioPlat(),
      spotify: [
        linha("BRASIL", 1, "TED - Bastarda", "900"),
        linha("REINO UNIDO", 2, "Jessica Johnson - Sweet Spot", "80"),
        linha("REINO UNIDO", 1, "Rayna - Shapeshifter", "2.592.249"),
        linha("ÁUSTRIA", 1, "Brida - Follia", "10"),
        linha("COREIA DO SUL", 1, "Brida - Follia", "10"),
      ],
      apple: [linha("REINO UNIDO", 1, "TED - Bastarda", "7")],
    },
  });
  const p = await montarPlaylist({ tipo: "pais", plataforma: "spotify", pais: "REINO UNIDO" }, fontes);
  expect(p).toMatchObject({
    id: "pais:spotify:REINO UNIDO",
    titulo: "Top 50 Reino Unido",
    subtitulo: "Spotify · ao vivo",
    plataforma: "spotify",
    aoVivo: true,
    capa_url: "shape.jpg",
  });
  expect(p!.faixas.map((f) => [f.pos, f.titulo, f.valor])).toEqual([
    [1, "Shapeshifter", "2.592.249"],
    [2, "Sweet Spot", "80"],
  ]);
  // id sem acento acha o país com acento; título mantém o acento
  const austria = await montarPlaylist({ tipo: "pais", plataforma: "spotify", pais: "AUSTRIA" }, fontes);
  expect(austria).toMatchObject({ titulo: "Top 50 Áustria", id: "pais:spotify:ÁUSTRIA" });
  expect((await montarPlaylist({ tipo: "pais", plataforma: "spotify", pais: "COREIA DO SUL" }, fontes))!.titulo).toBe("Top 50 Coreia do Sul");
  expect((await montarPlaylist({ tipo: "pais", plataforma: "apple", pais: "REINO UNIDO" }, fontes))!.subtitulo).toBe("Apple Music · ao vivo");
  expect(await montarPlaylist({ tipo: "pais", plataforma: "spotify", pais: "JAPÃO" }, fontes)).toBeNull();
  expect(await montarPlaylist({ tipo: "pais", plataforma: "youtube", pais: "REINO UNIDO" }, fontes)).toBeNull();
});

const linhaParada = (pais: string, pos: number, tit: string, val: string) =>
  ({ pais, pos, tit, val, mes: "", art: "", capa: "", st: "", ordem: 1, desc: "" });

test("montarPlaylist semana: Global 100, parada (inexistente → null), gênero só com faixas do catálogo daquele gênero", async () => {
  const fontes = fontesFalsas({
    catalogo: CAT_PLAYLISTS,
    semana: {
      global100: [
        { titulo: "TED - Bastarda", valor: "300.000" },
        { titulo: "Ninguém - Inexistente", valor: "250.000" },
        { titulo: "Brida - Follia", valor: "200.000" },
        { titulo: "Jessica Johnson - Sweet Spot", valor: "150.000" },
        { titulo: "Rayna - Shapeshifter", valor: "100.000" },
      ],
      paradas: [
        linhaParada("UK CHARTS", 2, "Rayna - Shapeshifter", "20"),
        linhaParada("BILLBOARD HOT 100", 1, "TED - Bastarda", "99"),
        linhaParada("UK CHARTS", 1, "Ninguém - Inexistente", "30"),
      ],
    },
  });
  const g = await montarPlaylist({ tipo: "global100" }, fontes);
  expect(g).toMatchObject({ id: "semana:global100", titulo: "Global 100", subtitulo: "Da semana · fecha quinta", plataforma: null, aoVivo: false, capa_url: "bast.jpg" });
  expect(g!.faixas.map((f) => [f.pos, f.valor, f.tocavel])).toEqual([
    [1, "300.000", true],
    [2, "250.000", false],
    [3, "200.000", true],
    [4, "150.000", true],
    [5, "100.000", true],
  ]);

  const uk = await montarPlaylist({ tipo: "parada", parada: "UK CHARTS" }, fontes);
  expect(uk).toMatchObject({ id: "semana:parada:UK CHARTS", titulo: "UK CHARTS", subtitulo: "Da semana · fecha quinta", aoVivo: false });
  // faixa sem catálogo fica na posição certa, sem capa
  expect(uk!.faixas.map((f) => [f.pos, f.titulo, f.tocavel])).toEqual([
    [1, "Inexistente", false],
    [2, "Shapeshifter", true],
  ]);
  expect(uk!.capa_url).toBeNull();
  expect(await montarPlaylist({ tipo: "parada", parada: "NADA" }, fontes)).toBeNull();

  const pop = await montarPlaylist({ tipo: "genero", genero: "POP" }, fontes);
  expect(pop).toMatchObject({ id: "semana:genero:POP", titulo: "Top Pop", subtitulo: "Da semana · fecha quinta", aoVivo: false, capa_url: "follia.jpg" });
  expect(pop!.faixas.map((f) => [f.pos, f.titulo, f.valor])).toEqual([
    [3, "Follia", "200.000"],
    [4, "Sweet Spot", "150.000"],
    [5, "Shapeshifter", "100.000"],
  ]);
  expect((await montarPlaylist({ tipo: "genero", genero: "RAP" }, fontes))!.faixas.map((f) => f.titulo)).toEqual(["Bastarda"]);
  expect(await montarPlaylist({ tipo: "genero", genero: "JAZZ" }, fontes)).toBeNull();
});

test("montarPlaylist hot: itens do D1 na ordem, com clipe pelo código único", async () => {
  const cat = catalogoDeTeste(
    [{ titulo: "Nova", artista: "Rayna", codigo_unico: "N1", audioUrl: "n.mp3", coverUrl: "nova.jpg" }],
    [{ titulo: "Nova (Clipe)", codigo_unico: "N1", tipo_video: "Music Video", videoUrl: "nv.mp4" }],
  );
  const hot: EmpirePlayCleanItem[] = [
    { id: "musicas_1", type: "musicas", title: "Nova", artist: "Rayna", codigoUnico: "N1", audioUrl: "n.mp3", coverUrl: "nova.jpg" },
    { id: "musicas_2", type: "musicas", title: "Muda", artist: "TED", displayArtists: "TED, Brida" },
  ];
  const p = await montarPlaylist({ tipo: "hot" }, fontesFalsas({ catalogo: cat, hot }));
  expect(p).toMatchObject({ id: "semana:hot", titulo: "Hot", subtitulo: "Lançamentos recentes", plataforma: null, aoVivo: false, capa_url: "nova.jpg" });
  expect(p!.faixas[0]).toMatchObject({ chave: "N1", pos: 1, titulo: "Nova", artista: "Rayna", tocavel: true });
  expect(p!.faixas[0].clipe?.videoUrl).toBe("nv.mp4");
  expect(p!.faixas[1]).toMatchObject({ chave: "musicas_2", pos: 2, artista: "TED, Brida", tocavel: false, capa_url: null, clipe: null });
});

test("carregarHot: 30 mais recentes do D1 sem pendentes, cache de 5 min, sem D1 → vazio", async () => {
  limparCachePlaylists();
  expect(await carregarHot(undefined)).toEqual([]);
  limparCachePlaylists();
  const consultas: string[] = [];
  const db = criarD1Sqlite(":memory:", (sql) => consultas.push(sql));
  for (const s of MUSICAS_CREATE_STATEMENTS) db.exec(s);
  const valores = Array.from({ length: 35 }, (_, i) => {
    const dia = String(i + 1).padStart(2, "0");
    return `('k${i}', 'C${i}', 'Musica ${i}', 'Artista', '2026-10-${dia}', ${i === 34 ? 1 : 0})`;
  });
  db.exec(`INSERT INTO musicas (chave, codigo_unico, titulo, artista, data_lancamento_iso, pendente) VALUES ${valores.join(",")}`);
  db.exec(`INSERT INTO musicas (chave, codigo_unico, titulo, artista, data_lancamento_iso, pendente) VALUES ('kx', 'CX', 'Sem Data', 'Artista', NULL, 0)`);
  try {
    const hot = await carregarHot(db);
    expect(hot.length).toBe(30);
    expect(hot[0].title).toBe("Musica 33"); // 34 é pendente
    expect(hot[29].title).toBe("Musica 4");
    expect(hot.some((h) => h.title === "Sem Data")).toBe(false);
    const n = consultas.length;
    expect(await carregarHot(db)).toBe(hot);
    expect(consultas.length).toBe(n);
    expect(consultas.every((s) => /^\s*SELECT/i.test(s))).toBe(true);
    expect(consultas.some((s) => /ORDER BY data_lancamento_iso DESC/i.test(s) && /LIMIT/i.test(s))).toBe(true);
  } finally {
    limparCachePlaylists();
  }
});

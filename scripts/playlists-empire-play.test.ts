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
  emTitulo,
  montarIndice,
  fontesReais,
  type CatalogoTocavel,
  type FontesPlaylists,
  type SemanaPlaylists,
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

type OverFontes = Partial<Omit<{ [K in keyof FontesPlaylists]: Awaited<ReturnType<FontesPlaylists[K]>> }, "semana">> & {
  semana?: Partial<SemanaPlaylists>;
};

function fontesFalsas(over: OverFontes): FontesPlaylists {
  const cat = over.catalogo ?? catalogoDeTeste([], []);
  const semana: SemanaPlaylists = { global100: [], paradas: [], plataformas: vazioPlat(), paises: vazioPlat(), ...over.semana };
  return {
    emAlta: async () => over.emAlta ?? vazioPlat(),
    aoVivoPaises: async () => over.aoVivoPaises ?? vazioPlat(),
    semana: async () => semana,
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
  // id volta como foi pedido (sem acento); o título usa a grafia de pais_peso
  expect(austria).toMatchObject({ titulo: "Top 50 Áustria", id: "pais:spotify:AUSTRIA" });
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
  expect(await montarPlaylist({ tipo: "parada", parada: "uk charts" }, fontes)).toMatchObject({ id: "semana:parada:uk charts", titulo: "UK CHARTS" });

  const pop = await montarPlaylist({ tipo: "genero", genero: "POP" }, fontes);
  expect(pop).toMatchObject({ id: "semana:genero:POP", titulo: "Top Pop", subtitulo: "Da semana · fecha quinta", aoVivo: false, capa_url: "follia.jpg" });
  // pos = posição no gênero; posGlobal = posição no Global 100
  expect(pop!.faixas.map((f) => [f.pos, f.posGlobal, f.titulo, f.valor])).toEqual([
    [1, 3, "Follia", "200.000"],
    [2, 4, "Sweet Spot", "150.000"],
    [3, 5, "Shapeshifter", "100.000"],
  ]);
  // id montado à mão com gênero sem normalizar também funciona
  expect(await montarPlaylist({ tipo: "genero", genero: "pop" }, fontes)).toEqual(pop);
  expect(g!.faixas.every((f) => f.posGlobal === undefined)).toBe(true);
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
    const data = new Date(Date.UTC(2026, 9, 1 + i)).toISOString().slice(0, 10); // 2026-10-01 .. 2026-11-04
    return `('k${i}', 'C${i}', 'Musica ${i}', 'Artista', '${data}', ${i === 34 ? 1 : 0})`;
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

test("emTitulo: palavras em Título, conectivos minúsculos, sigla de até 3 letras (palavra única) mantida", () => {
  expect(emTitulo("REINO UNIDO")).toBe("Reino Unido");
  expect(emTitulo("COREIA DO SUL")).toBe("Coreia do Sul");
  expect(emTitulo("EUA")).toBe("EUA");
  expect(emTitulo("UK")).toBe("UK");
  expect(emTitulo("SÃO TOMÉ")).toBe("São Tomé"); // sigla só quando é a palavra sozinha
  expect(emTitulo("ÁUSTRIA")).toBe("Áustria");
  expect(emTitulo("GUINÉ-BISSAU")).toBe("Guiné-Bissau");
  expect(emTitulo("  PAÍSES   BAIXOS ")).toBe("Países Baixos");
  expect(emTitulo("POP", { siglas: false })).toBe("Pop");
  expect(emTitulo("r&b")).toBe("R&B");
});

test("montarPlaylist país: sigla no título fica em caixa alta (Top 50 EUA)", async () => {
  const fontes = fontesFalsas({
    aoVivoPaises: { ...vazioPlat(), spotify: [{ pais: "EUA", pos: 1, t: "A - B", s: "1", c: "", art: "" }] },
  });
  expect(await montarPlaylist({ tipo: "pais", plataforma: "spotify", pais: "EUA" }, fontes)).toMatchObject({ titulo: "Top 50 EUA", id: "pais:spotify:EUA" });
});

// ---- Índice (prateleiras + destaque) ----

const linhaPais = (pais: string, pos: number, t: string, s: string) => ({ pais, pos, t, s, c: "", art: "" });
const linhaSemanaPais = (pais: string, pos: number, tit: string) =>
  ({ pais, pos, tit, val: "1", mes: "", art: "", capa: "", st: "" });
const linhaParadaOrdem = (pais: string, ordem: number, pos: number, tit: string) =>
  ({ ...linhaParada(pais, pos, tit, "1"), ordem });

/** 12 Pop, 10 Axé, 10 Rock, 9 Rap no catálogo (todas no Global 100). */
function catalogoGeneros(): { cat: CatalogoTocavel; global100: { titulo: string; valor: string }[] } {
  const grupos: [string, number][] = [["Rock", 10], ["Pop", 12], ["Rap", 9], ["Axé", 10]];
  const musicas: MusicaTeste[] = [];
  for (const [genero, n] of grupos)
    for (let i = 0; i < n; i++)
      musicas.push({ titulo: `${genero} ${i}`, artista: `Art ${genero}`, codigo_unico: `${genero}${i}`, audioUrl: "x.mp3", coverUrl: `${genero}${i}.jpg`, genero });
  return {
    cat: catalogoDeTeste(musicas, []),
    global100: musicas.map((m, k) => ({ titulo: `${m.artista} - ${m.titulo}`, valor: String(1000 - k) })),
  };
}

function fontesIndice(): FontesPlaylists {
  const { cat, global100 } = catalogoGeneros();
  return fontesFalsas({
    catalogo: cat,
    emAlta: {
      spotify: [{ t: "Art Pop - Pop 3", n: 5000, s: "", p: "", c: "" }],
      apple: [{ t: "Art Rock - Rock 1", n: 400, s: "", p: "", c: "" }],
      youtube: [{ t: "Art Rap - Rap 2", n: 30, s: "", p: "", c: "" }],
    },
    aoVivoPaises: {
      spotify: [
        linhaPais("ESTADOS UNIDOS", 1, "Art Pop - Pop 1", "10"),
        linhaPais("REINO UNIDO", 2, "Art Pop - Pop 2", "5"),
        linhaPais("REINO UNIDO", 1, "Art Rock - Rock 2", "9"),
        linhaPais("ÁUSTRIA", 1, "Art Axé - Axé 0", "1"),
      ],
      apple: [linhaPais("BRASIL", 1, "Art Axé - Axé 1", "3")],
      youtube: [],
    },
    semana: {
      global100,
      paradas: [
        linhaParadaOrdem("UK CHARTS", 2, 1, "Art Rap - Rap 0"),
        linhaParadaOrdem("BILLBOARD HOT 100", 1, 1, "Art Pop - Pop 0"),
        linhaParadaOrdem("ARIA", 2, 1, "Art Rock - Rock 0"),
        linhaParadaOrdem("BILLBOARD HOT 100", 1, 2, "Art Rap - Rap 1"),
      ],
    },
    hot: [{ id: "musicas_h", type: "musicas", title: "Nova", artist: "Rayna", coverUrl: "nova.jpg" }],
  });
}

test("montarIndice: ordem das prateleiras, países na ordem recebida (peso), gêneros ≥ 10 + Hot no fim", async () => {
  const fontes = fontesIndice();
  const ind = await montarIndice(fontes);
  expect(ind.globais.map((c) => c.id)).toEqual(["ao-vivo:spotify", "ao-vivo:apple", "ao-vivo:youtube", "semana:global100"]);
  expect(ind.paises.spotify.map((c) => [c.id, c.titulo])).toEqual([
    ["pais:spotify:ESTADOS UNIDOS", "Top 50 Estados Unidos"],
    ["pais:spotify:REINO UNIDO", "Top 50 Reino Unido"],
    ["pais:spotify:ÁUSTRIA", "Top 50 Áustria"],
  ]);
  expect(ind.paises.apple.map((c) => c.id)).toEqual(["pais:apple:BRASIL"]);
  expect(ind.paises.youtube).toEqual([]);
  // paradas pela `ordem`, empate pelo nome
  expect(ind.paradas.map((c) => c.titulo)).toEqual(["BILLBOARD HOT 100", "ARIA", "UK CHARTS"]);
  // Pop (12), depois Axé e Rock (10, pelo nome); Rap (9) fica fora; Hot por último
  expect(ind.generos.map((c) => [c.id, c.titulo])).toEqual([
    ["semana:genero:POP", "Top Pop"],
    ["semana:genero:AXE", "Top Axé"],
    ["semana:genero:ROCK", "Top Rock"],
    ["semana:hot", "Hot"],
  ]);
  // cada cartão = o resumo da playlist que ele abre (mesmo id, título, capa da #1)
  const todos = [...ind.globais, ...ind.paises.spotify, ...ind.paises.apple, ...ind.paradas, ...ind.generos];
  for (const c of todos) {
    const p = (await montarPlaylist(parseIdPlaylist(c.id)!, fontes))!;
    expect(c).toEqual({ id: p.id, titulo: p.titulo, subtitulo: p.subtitulo, capa_url: p.capa_url, aoVivo: p.aoVivo });
  }
  expect(ind.paises.spotify[1].capa_url).toBe("Rock2.jpg");
  // determinístico
  expect(await montarIndice(fontes)).toEqual(ind);
});

test("montarIndice: sem dados → listas vazias e destaque null", async () => {
  expect(await montarIndice(fontesFalsas({}))).toEqual({
    destaque: null,
    globais: [],
    paises: { spotify: [], apple: [], youtube: [] },
    paradas: [],
    generos: [],
  });
});

test("destaque: maior subida do #1 ao vivo contra o último chart semanal; empate por valor ao vivo; sem subida → Spotify Global", async () => {
  const base = {
    catalogo: CAT_PLAYLISTS,
    emAlta: {
      spotify: [{ t: "Rayna - Shapeshifter", n: 1000, s: "", p: "", c: "" }],
      apple: [{ t: "TED - Bastarda", n: 50, s: "", p: "", c: "" }],
      youtube: [],
    },
  };
  const semanal = (titulos: string[]) => titulos.map((titulo, k) => ({ titulo, pos: k + 1 }));
  const fontes = fontesFalsas({
    ...base,
    aoVivoPaises: {
      spotify: [
        linhaPais("BRASIL", 1, "Brida - Follia", "100"),
        linhaPais("REINO UNIDO", 1, "Brida - Follia", "2.592.249"),
      ],
      apple: [],
      youtube: [],
    },
    semana: {
      plataformas: {
        // Shapeshifter era #3 → subiu 2
        spotify: semanal(["A - 1", "B - 2", "Rayna - Shapeshifter", "C - 4"]),
        // Bastarda não estava (4 faixas) → subiu 4
        apple: semanal(["A - 1", "B - 2", "C - 3", "D - 4"]),
        youtube: [],
      },
      paises: {
        spotify: [
          // Follia era #7 nos dois países → subiu 6; Reino Unido vence pelo valor ao vivo
          ...["A", "B", "C", "D", "E", "F"].map((x, k) => linhaSemanaPais("REINO UNIDO", k + 1, `${x} - x`)),
          linhaSemanaPais("REINO UNIDO", 7, "BRIDA - FOLLIA"),
          ...["A", "B", "C", "D", "E", "F"].map((x, k) => linhaSemanaPais("BRASIL", k + 1, `${x} - x`)),
          linhaSemanaPais("BRASIL", 7, "Brida - Follia"),
        ],
        apple: [],
        youtube: [],
      },
    },
  });
  expect((await montarIndice(fontes)).destaque).toEqual({
    id: "pais:spotify:REINO UNIDO",
    titulo: "Top 50 Reino Unido",
    musica: "Brida - Follia",
    subiu: 6,
    valor: "2.592.249",
    capa_url: "follia.jpg",
  });

  // Sem os países: Apple (fora do chart semanal de 4 → subiu 4) vence o Spotify (subiu 2)
  const semPaises = fontesFalsas({
    ...base,
    semana: {
      plataformas: { spotify: semanal(["A - 1", "B - 2", "Rayna - Shapeshifter"]), apple: semanal(["A - 1", "B - 2", "C - 3", "D - 4"]), youtube: [] },
    },
  });
  expect((await montarIndice(semPaises)).destaque).toMatchObject({ id: "ao-vivo:apple", subiu: 4, musica: "TED - Bastarda", valor: "50" });

  // Ninguém subiu (#1 já era #1; chart semanal vazio conta 0) → Spotify Global com subiu 0
  const parado = fontesFalsas({
    ...base,
    semana: { plataformas: { spotify: semanal(["Rayna - Shapeshifter", "A - 1"]), apple: [], youtube: [] } },
  });
  expect((await montarIndice(parado)).destaque).toEqual({
    id: "ao-vivo:spotify",
    titulo: "Top 100 Spotify Global",
    musica: "Rayna - Shapeshifter",
    subiu: 0,
    valor: "1.000",
    capa_url: "shape.jpg",
  });
});

test("destaque: empate em subida e valor → menor id", async () => {
  const fontes = fontesFalsas({
    catalogo: CAT_PLAYLISTS,
    aoVivoPaises: {
      spotify: [linhaPais("REINO UNIDO", 1, "Brida - Follia", "10"), linhaPais("BRASIL", 1, "Brida - Follia", "10")],
      apple: [],
      youtube: [],
    },
    semana: {
      paises: {
        spotify: [linhaSemanaPais("REINO UNIDO", 1, "A - x"), linhaSemanaPais("BRASIL", 1, "A - x")],
        apple: [],
        youtube: [],
      },
    },
  });
  expect((await montarIndice(fontes)).destaque).toMatchObject({ id: "pais:spotify:BRASIL", subiu: 1 });
});

// ---- Rota /api/empire-play/playlists (fontes reais: D1 SQLite + planilhas trocadas) ----
import { googleSheetsService } from "../backend/src/services/googleSheetsService";
import { definirRelogioAoVivo, limparCacheCharts } from "../backend/src/controllers/chartsController";
import { getPlaylistsEmpirePlayController } from "../backend/src/controllers/playlistsEmpirePlayController";
import { ingerirSemana } from "../backend/src/services/chartsD1/repo";

const EM_ALTA_PLAYLISTS: string[][] = [
  ["", "Título", "", "Streams", "Plataforma", "Var", "Capa"],
  ["", "Art9 - Song9", "", "9.000.000", "Spotify", "+1", ""],
  ["", "Art1 - Song1", "", "5.000.000", "Spotify", "-", ""],
  ["", "Art2 - Song2", "", "700.000", "Apple Music", "=", ""],
  ["", "Art3 - Song3", "", "50.000", "YouTube", "+2", ""],
];

/** D1 em memória: catálogo (10 Pop) + 2 semanas de charts ativadas; `consultas` só registra depois de montado. */
async function bancoPlaylists() {
  const consultas: string[] = [];
  let gravando = false;
  const db = criarD1Sqlite(":memory:", (sql) => { if (gravando) consultas.push(sql); });
  for (const s of [...MUSICAS_CREATE_STATEMENTS, ...VIDEOS_CREATE_STATEMENTS, ...CHARTS_D1_SCHEMA]) db.exec(s);
  const musicas = Array.from({ length: 10 }, (_, i) => [`Art${i} - Song${i}`, `Art${i}`]);
  db.exec(`INSERT INTO musicas (chave, codigo_unico, titulo, artista, capa_url, audio_url, genero, pendente) VALUES ${
    musicas.map((_, i) => `('k${i}', 'S${i}', 'Song${i}', 'Art${i}', 'capa${i}.jpg', 'a${i}.mp3', 'Pop', 0)`).join(",")}`);
  const charts = ["BILLBOARD HOT 100", "SPOTIFY", "YOUTUBE", "APPLE MUSIC", "DIGITAL SALES"];
  const semana = (data: string, fator: number) =>
    charts.flatMap((chart, ci) =>
      musicas.map((_, i) => musicas[(i + ci + fator) % musicas.length]).map(([titulo, art], i) =>
        [chart, data, String(i + 1), titulo, String((musicas.length - i) * 1000 * fator), "", "", art]),
    );
  const pesos = [
    ["ESTADOS UNIDOS", "30,00%", "35,00%", "25,00%"],
    ["REINO UNIDO", "8,00%", "9,00%", "6,00%"],
    ["AUSTRÁLIA", "2,00%", "2,50%", "1,50%"],
  ];
  const artistas = [["Art0", "Australia", "", ""], ["Art1", "Reino Unido", "", ""], ["Art2", "Estados Unidos", "", ""]];
  for (const [data, fator] of [["04/11/2026", 1], ["11/11/2026", 2]] as const) {
    const r = await ingerirSemana(db, { linhas: semana(data, fator), modo: "historico", pesos, artistas });
    if (!r.ok) throw new Error(JSON.stringify(r));
  }
  expect(await ingerirSemana(db, { ativar: true })).toEqual({ ok: true, ativo: true });
  gravando = true;
  return { db, consultas };
}

/** Roda `fn` com `db` como D1 do app, planilhas trocadas (EM Alta simulada) e relógio do ao vivo injetado. */
async function comRotaPlaylists(db: unknown, fn: (lidas: string[], avancar: (ms: number) => void) => Promise<void>) {
  const g = globalThis as Record<string, unknown>;
  const svc = googleSheetsService as unknown as Record<string, { readValues: (s: string) => Promise<string[][]> }>;
  const chaves = ["chartsBase", "chartsCountries", "chartsAlbums", "principal", "chartsRealtime"];
  const antes = { db: g.__CATALOGO_DB__, ...Object.fromEntries(chaves.map((k) => [k, svc[k].readValues])) } as Record<string, any>;
  const lidas: string[] = [];
  let agora = 1_000_000;
  g.__CATALOGO_DB__ = db;
  for (const k of chaves)
    svc[k].readValues = async (s: string) => {
      lidas.push(`${k}:${s}`);
      return k === "chartsRealtime" && s === "EM Alta" ? EM_ALTA_PLAYLISTS : [];
    };
  definirRelogioAoVivo(() => agora);
  limparCacheCharts();
  limparCachePlaylists();
  try {
    await fn(lidas, (ms) => { agora += ms; });
  } finally {
    g.__CATALOGO_DB__ = antes.db;
    for (const k of chaves) svc[k].readValues = antes[k];
    definirRelogioAoVivo(null);
    limparCacheCharts();
    limparCachePlaylists();
  }
}
const rota = (q = "") => getPlaylistsEmpirePlayController(new Request(`http://x/api/empire-play/playlists${q}`));

test("rota: id inválido ou inexistente → 404 com a mensagem exata", async () => {
  const { db } = await bancoPlaylists();
  await comRotaPlaylists(db, async () => {
    for (const q of ["?id=pais:spotify:MARTE", "?id=qualquer", "?id=", "?id=semana:parada:NADA", "?id=semana:genero:JAZZ"]) {
      const r = await rota(q);
      expect(r.status).toBe(404);
      expect(await r.json()).toEqual({ success: false, error: "Playlist não encontrada." });
    }
  });
});

test("rota sem D1 → índice com listas vazias, destaque null, status 200", async () => {
  await comRotaPlaylists(undefined, async () => {
    const svc = googleSheetsService as unknown as Record<string, { readValues: (s: string) => Promise<string[][]> }>;
    svc.chartsRealtime.readValues = async () => [];
    const r = await rota();
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({
      success: true,
      data: { destaque: null, globais: [], paises: { spotify: [], apple: [], youtube: [] }, paradas: [], generos: [] },
    });
  });
});

test("rota com D1: índice e playlist das fontes reais, só SELECT, só a EM Alta lida, 1 leitura em 30 s", async () => {
  const { db, consultas } = await bancoPlaylists();
  await comRotaPlaylists(db, async (lidas, avancar) => {
    const r = await rota();
    expect(r.status).toBe(200);
    const corpo = (await r.json()) as { success: boolean; data: Awaited<ReturnType<typeof montarIndice>> };
    expect(corpo.success).toBe(true);
    const ind = corpo.data;
    expect(ind).toEqual(JSON.parse(JSON.stringify(await montarIndice(fontesReais()))));
    expect(ind.globais.map((c) => c.id)).toEqual(["ao-vivo:spotify", "ao-vivo:apple", "ao-vivo:youtube", "semana:global100"]);
    expect(ind.globais[0]).toMatchObject({ titulo: "Top 100 Spotify Global", capa_url: "capa9.jpg", aoVivo: true });
    expect(ind.paises.spotify.map((c) => c.id)).toEqual(["pais:spotify:ESTADOS UNIDOS", "pais:spotify:REINO UNIDO", "pais:spotify:AUSTRÁLIA"]);
    expect(ind.paradas.length).toBeGreaterThan(0);
    expect(ind.generos.map((c) => c.id)).toEqual(["semana:genero:POP"]); // sem lançamentos datados → sem Hot
    // Song3 (#1 ao vivo no YouTube) era #10 no último YOUTUBE semanal → subiu 9
    expect(ind.destaque).toEqual({
      id: "ao-vivo:youtube", titulo: "Top 100 YouTube Hits", musica: "Art3 - Song3", subiu: 9, valor: "50.000", capa_url: "capa3.jpg",
    });

    const g = await rota("?id=semana:global100");
    expect(g.status).toBe(200);
    const pl = ((await g.json()) as { data: { id: string; faixas: { pos: number; tocavel: boolean }[] } }).data;
    expect(pl.id).toBe("semana:global100");
    expect(pl.faixas.map((f) => f.pos)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(pl.faixas.every((f) => f.tocavel)).toBe(true);
    const uk = await rota(`?id=${encodeURIComponent("pais:spotify:REINO UNIDO")}`);
    expect(((await uk.json()) as { data: { titulo: string } }).data.titulo).toBe("Top 50 Reino Unido");

    // 2ª chamada em < 30 s: mesma resposta, nenhuma leitura nova (planilha ou D1).
    // Sem o catálogo em cache, só o cache de resposta evita reler `musicas`.
    limparCachePlaylists();
    const n = consultas.length;
    avancar(10_000);
    expect(await (await rota()).json()).toEqual(corpo);
    expect(consultas.length).toBe(n);
    expect(lidas).toEqual(["chartsRealtime:EM Alta"]);
    // passou de 30 s: nova leitura da EM Alta
    avancar(21_000);
    await rota();
    expect(lidas).toEqual(["chartsRealtime:EM Alta", "chartsRealtime:EM Alta"]);
    expect(consultas.every((s) => /^\s*SELECT/i.test(s))).toBe(true);
  });
});

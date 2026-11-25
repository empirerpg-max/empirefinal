// Espelho D1 de ARTISTAS. Uso: bun test scripts/artistas-d1.test.ts
import { test, expect, beforeEach } from "bun:test";
import { criarD1Sqlite } from "./charts-d1-sqlite";
import {
  ARTISTAS_SCHEMA, registroDaLinha, carregarArtistas, buscarArtista, limparCacheArtistas,
  importarArtistas, reconciliarArtistas, atualizarDaPlanilha, gravarPerfil,
} from "../backend/src/services/artistasD1";

const CAB = ["Nome","Foto","Status","Saldo","Gravadora","Fortuna Vendas","Fortuna Turnês","Fortuna Total","Prestígio","Fadiga","ID Usuário","Data_Contrato","Meses_Contrato","Multa","Fortuna Cálculo","ID_unico","Fortuna Charts","BIOGRAFIA","FOTO","GÊNERO PRINCIPAL","PAÍS","CAPA PERFIL","ANO EM QUE INICIOU A CARREIRA","GÊNERO","ARTISTA BASE"];
const FOTO = "https://drive.google.com/uc?export=view&id=1sn-71XBEx21-7uA8ecZe1QB8fn5MWa_F";
const RAVEN = ["Raven",FOTO,"","","Crown","3.174.369.593","","3.174.369.593","","","1198902945","13/05/2026","","","","Raven1198902945","3.161.943.200","Raven é uma das maiores popstars...",FOTO,"POP","PORTO RICO","","2015","MULHER","Selena Gomez"];

beforeEach(() => limparCacheArtistas());

test("registroDaLinha da Raven", () => {
  const a = registroDaLinha(CAB, RAVEN, 5)!;
  expect(a).toMatchObject({ nome: "Raven", idUnico: "Raven1198902945", idUsuario: "1198902945", generoPrincipal: "POP", pais: "PORTO RICO", sexo: "MULHER", artistaBase: "Selena Gomez", fotoUrl: FOTO, gravadora: "Crown", anoInicio: "2015", linhaPlanilha: 5 });
});

test("FOTO vazia cai em Foto; sem nome é null; sem ID_unico vira nome+idUsuario", () => {
  const l = [...RAVEN]; l[18] = ""; l[1] = "http://foto"; l[15] = "";
  const a = registroDaLinha(CAB, l, 2)!;
  expect(a.fotoUrl).toBe("http://foto");
  const f = [...RAVEN]; f[1] = "http://outra"; f[18] = "http://FOTO-S";
  expect(registroDaLinha(CAB, f, 2)!.fotoUrl).toBe("http://FOTO-S");
  expect(a.idUnico).toBe("Raven1198902945");
  const s = [...RAVEN]; s[0] = "";
  expect(registroDaLinha(CAB, s, 2)).toBeNull();
});

function inserir(db: ReturnType<typeof criarD1Sqlite>, id: string, nome: string, chave: string, linha: number) {
  void db.prepare("INSERT INTO artistas (id_unico, nome, nome_chave, linha_planilha, atualizado_em) VALUES (?, ?, ?, ?, ?)").bind(id, nome, chave, linha, "x").run();
}

test("buscarArtista acha Aimê por aime e renomeado por sebastian", async () => {
  const db = criarD1Sqlite();
  for (const s of ARTISTAS_SCHEMA) db.exec(s);
  inserir(db, "Aime1", "Aimê", "AIME", 2);
  inserir(db, "Tyler Strand272193453", "Sebastian", "SEBASTIAN", 3);
  expect((await buscarArtista(db, "aime"))?.nome).toBe("Aimê");
  expect((await buscarArtista(db, "sebastian"))?.idUnico).toBe("Tyler Strand272193453");
  expect(await buscarArtista(db, "ninguem")).toBeNull();
});

test("sem tabela: cria o schema e devolve mapa vazio", async () => {
  const db = criarD1Sqlite();
  expect((await carregarArtistas(db)).size).toBe(0);
});

// ---- Task 2: importação, reconciliação, atualização pelo admin e gravação ----

const HOJE = new Date("2026-11-25T12:00:00Z");

function dbComConfig() {
  const db = criarD1Sqlite();
  db.exec("CREATE TABLE chart_config (chave TEXT PRIMARY KEY, valor TEXT)");
  db.exec("CREATE TABLE pais_peso (plataforma TEXT NOT NULL, pais TEXT NOT NULL, peso REAL, PRIMARY KEY (plataforma, pais))");
  db.exec("INSERT INTO pais_peso VALUES ('SPOTIFY','ESTADOS UNIDOS',1),('APPLE','ESTADOS UNIDOS',1),('SPOTIFY','MÉXICO',1),('SPOTIFY','PORTO RICO',1)");
  return db;
}

async function linhaD1(db: ReturnType<typeof criarD1Sqlite>, id: string) {
  const { results } = await db.prepare("SELECT * FROM artistas WHERE id_unico = ?").bind(id).all<Record<string, unknown>>();
  return results[0];
}

// INFOS ACTS: A nome | C foto | E bio | G foto | N nacionalidade | R capa | S capa mobile
function linhaInfos(nome: string, v: { c?: string; e?: string; g?: string; n?: string; r?: string; s?: string }) {
  const l = Array(19).fill("");
  l[0] = nome; l[2] = v.c ?? ""; l[4] = v.e ?? ""; l[6] = v.g ?? ""; l[13] = v.n ?? ""; l[17] = v.r ?? ""; l[18] = v.s ?? "";
  return l;
}

const SEM_PAIS = (() => { const l = [...RAVEN]; l[0] = "Lúna"; l[15] = "Luna1"; l[20] = ""; l[17] = ""; l[18] = ""; l[1] = ""; return l; })();

test("importação: país vazio vem da INFOS ACTS (com célula pra planilha); ARTISTAS preenchida vence", async () => {
  const db = dbComConfig();
  const r = await importarArtistas(db, {
    artistas: async () => [CAB, RAVEN, SEM_PAIS],
    infosActs: async () => [
      ["Nome"],
      linhaInfos("RAVEN", { n: "MÉXICO", e: "outra bio", c: "http://outra" }),
      linhaInfos("luna", { n: "ESTADOS UNIDOS", c: "http://c", g: "http://g", e: "bio da luna" }),
    ],
  }, HOJE);
  expect(r.total).toBe(2);
  expect(r.complementados).toBe(1);
  const luna = await linhaD1(db, "Luna1");
  expect(luna).toMatchObject({ pais: "ESTADOS UNIDOS", pais_definido_em: "2026-11-25", biografia: "bio da luna", foto_url: "http://c", nome_chave: "LUNA" });
  expect(r.celulas).toContainEqual({ linha: 3, coluna: "PAÍS", valor: "ESTADOS UNIDOS" });
  expect(r.celulas).toContainEqual({ linha: 3, coluna: "FOTO", valor: "http://c" });
  expect(r.celulas).toContainEqual({ linha: 3, coluna: "Foto", valor: "http://c" });
  expect(r.celulas).toContainEqual({ linha: 3, coluna: "BIOGRAFIA", valor: "bio da luna" });
  expect(r.celulas.every((c) => c.linha === 3)).toBe(true);
  const raven = await linhaD1(db, "Raven1198902945");
  expect(raven).toMatchObject({ pais: "PORTO RICO", foto_url: FOTO, biografia: "Raven é uma das maiores popstars..." });
  const flag = await db.prepare("SELECT valor FROM chart_config WHERE chave = 'artistas_d1_importado'").all<{ valor: string }>();
  expect(flag.results[0]?.valor).toBe("1");
});

test("reconciliação: só roda com a marca; não muda biografia editada no D1 mas muda gravadora; cria os que faltam", async () => {
  const db = dbComConfig();
  for (const s of ARTISTAS_SCHEMA) db.exec(s);
  expect(await reconciliarArtistas(db, [CAB, RAVEN])).toBe(0);
  expect(await linhaD1(db, "Raven1198902945")).toBeUndefined();

  await importarArtistas(db, { artistas: async () => [CAB, RAVEN], infosActs: async () => [] }, HOJE);
  await db.prepare("UPDATE artistas SET biografia = 'editada no app', pais = 'MÉXICO' WHERE id_unico = 'Raven1198902945'").run();
  const nova = [...RAVEN]; nova[4] = "Nova Gravadora"; nova[17] = "bio da planilha"; nova[20] = "ESTADOS UNIDOS";
  const n = await reconciliarArtistas(db, [CAB, nova, SEM_PAIS]);
  expect(n).toBe(2);
  const raven = await linhaD1(db, "Raven1198902945");
  expect(raven).toMatchObject({ biografia: "editada no app", pais: "MÉXICO", gravadora: "Nova Gravadora" });
  expect((await linhaD1(db, "Luna1"))?.nome).toBe("Lúna");
  // Sem mudança: nada a gravar
  expect(await reconciliarArtistas(db, [CAB, nova, SEM_PAIS])).toBe(0);
});

test("atualizarDaPlanilha: sobrescreve tudo; PAÍS vazio libera o país e lista País", async () => {
  const db = dbComConfig();
  await importarArtistas(db, { artistas: async () => [CAB, RAVEN, SEM_PAIS], infosActs: async () => [] }, HOJE);
  await db.prepare("UPDATE artistas SET biografia = 'editada' WHERE id_unico = 'Raven1198902945'").run();
  const semPais = [...RAVEN]; semPais[20] = "";
  const r = await atualizarDaPlanilha(db, [CAB, semPais, SEM_PAIS], "Raven1198902945");
  expect(r).toHaveLength(1);
  expect(r[0].id).toBe("Raven1198902945");
  expect(r[0].campos).toContain("País");
  expect(r[0].campos).toContain("Biografia");
  const raven = await linhaD1(db, "Raven1198902945");
  expect(raven).toMatchObject({ pais: null, pais_definido_em: null, biografia: "Raven é uma das maiores popstars..." });
  // Todos de uma vez, sem mudança
  const todos = await atualizarDaPlanilha(db, [CAB, semPais, SEM_PAIS]);
  expect(todos.map((t) => t.campos.length)).toEqual([0, 0]);
});

test("gravarPerfil: dono define país vazio; segunda vez 409; admin troca; país inválido 400; copiar com erro não desfaz", async () => {
  const db = dbComConfig();
  await importarArtistas(db, { artistas: async () => [CAB, RAVEN, SEM_PAIS], infosActs: async () => [] }, HOJE);
  const copias: { celulas: { coluna: string; valor: string }[]; linha: number }[] = [];
  const copiar = async (celulas: { coluna: string; valor: string }[], linha: number) => { copias.push({ celulas, linha }); };

  const r1 = await gravarPerfil(db, "Luna1", { pais: "estados unidos" }, false, copiar);
  expect(r1.ok).toBe(true);
  if (r1.ok) expect(r1.artista.pais).toBe("ESTADOS UNIDOS");
  expect(copias[0]).toEqual({ celulas: [{ coluna: "PAÍS", valor: "ESTADOS UNIDOS" }], linha: 3 });
  expect((await buscarArtista(db, "luna"))?.pais).toBe("ESTADOS UNIDOS");

  const r2 = await gravarPerfil(db, "Luna1", { pais: "MÉXICO" }, false, copiar);
  expect(r2).toEqual({ ok: false, status: 409, erro: "A nacionalidade já foi definida. Peça à administração para alterar." });

  const r3 = await gravarPerfil(db, "Luna1", { pais: "mexico" }, true, copiar);
  expect(r3.ok && r3.artista.pais).toBe("MÉXICO");

  const r4 = await gravarPerfil(db, "Luna1", { pais: "NARNIA" }, true, copiar);
  expect(r4).toEqual({ ok: false, status: 400, erro: "País inválido." });

  expect(await gravarPerfil(db, "ninguem", { biografia: "x" }, true, copiar)).toEqual({ ok: false, status: 404, erro: "Artista não encontrado." });

  const r5 = await gravarPerfil(db, "Luna1", { fotoUrl: "http://nova", biografia: "nova bio" }, false, async () => { throw new Error("Google recusou"); });
  expect(r5.ok).toBe(true);
  const luna = await linhaD1(db, "Luna1");
  expect(luna).toMatchObject({ foto_url: "http://nova", biografia: "nova bio", pais: "MÉXICO" });

  copias.length = 0;
  await gravarPerfil(db, "Luna1", { fotoUrl: "http://n2" }, false, copiar);
  expect(copias[0].celulas).toEqual([{ coluna: "FOTO", valor: "http://n2" }, { coluna: "Foto", valor: "http://n2" }]);
});

// ---- Task 3: rotas de perfil, endpoints antigos e cron (sem INFOS ACTS) ----

import { googleSheetsService } from "../backend/src/services/googleSheetsService";
import { issueSessionToken, ADMIN_TG_ID } from "../backend/src/services/sessionService";
import { artistasPerfilController, rodarCronArtistas } from "../backend/src/controllers/artistasPerfilController";
import {
  getArtistInfoController, setArtistBiografiaController, setArtistFotoController, setArtistCapaController, getAllArtistasController,
} from "../backend/src/controllers/artistasController";
import { buildFotoPorArtista } from "../backend/src/controllers/awardsController";
import { MUSICAS_CREATE_STATEMENTS } from "../backend/src/services/musicasDbService";

type Planilha = { lidas: string[]; lotes: { range: string; valor: string }[][]; escritas: string[] };

/** Troca as planilhas por stubs (registrando abas lidas e células escritas) e injeta `db` como D1 do app. */
async function comPlanilhas(db: unknown, abas: { artistas: string[][]; infos: string[][] }, fn: (p: Planilha) => Promise<void>) {
  const g = globalThis as Record<string, unknown>;
  const svc = googleSheetsService as any;
  const trocas: [any, string, unknown][] = [];
  const trocar = (obj: any, k: string, v: unknown) => { trocas.push([obj, k, obj[k]]); obj[k] = v; };
  const p: Planilha = { lidas: [], lotes: [], escritas: [] };
  const ler = (planilha: string) => async (aba: string, range?: string) => {
    p.lidas.push(`${planilha}:${aba}`);
    if (planilha === "usuarios" && aba === "ARTISTAS") return range === "1:1" ? [abas.artistas[0]] : abas.artistas;
    if (planilha === "registrosCharts" && aba === "INFOS ACTS") return abas.infos;
    return [];
  };
  trocar(svc.usuarios, "readValues", ler("usuarios"));
  trocar(svc.usuarios, "readValuesFresh", ler("usuarios"));
  trocar(svc.registrosCharts, "readValues", ler("registrosCharts"));
  trocar(svc.usuarios, "updateValues", async (aba: string, range: string) => { p.escritas.push(`usuarios:${aba}!${range}`); return true; });
  trocar(svc.usuarios, "appendRow", async (aba: string) => { p.escritas.push(`usuarios:${aba}:append`); return 9; });
  trocar(svc.registrosCharts, "updateValues", async (aba: string, range: string) => { p.escritas.push(`registrosCharts:${aba}!${range}`); return true; });
  trocar(svc.registrosCharts, "updateValuesBatch", async () => { p.escritas.push("registrosCharts:batch"); return true; });
  trocar(svc, "updateValuesBatch", async (_k: string, e: { range: string; values: string[][] }[]) => { p.lotes.push(e.map((x) => ({ range: x.range, valor: x.values[0][0] }))); return true; });
  trocar(svc.edicaoCharts, "readValues", async () => []);
  trocar(svc.edicaoCharts, "updateValues", async () => true);
  trocar(svc.logsSistema, "readValues", async () => [["x"]]);
  trocar(svc.logsSistema, "appendRow", async () => 1);
  const antesDb = g.__CATALOGO_DB__;
  g.__CATALOGO_DB__ = db;
  limparCacheArtistas();
  try {
    await fn(p);
  } finally {
    g.__CATALOGO_DB__ = antesDb;
    for (const [obj, k, v] of trocas.reverse()) obj[k] = v;
    limparCacheArtistas();
  }
}

const DONO_RAVEN = "1198902945";
const req = (path: string, init: { method?: string; token?: string; body?: unknown } = {}) =>
  new Request(`http://x${path}`, {
    method: init.method ?? "GET",
    headers: init.token ? { Authorization: `Bearer ${init.token}` } : {},
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
const ABAS = {
  artistas: [CAB, RAVEN, SEM_PAIS],
  infos: [["Nome"], linhaInfos("luna", { n: "ESTADOS UNIDOS", c: "http://c", e: "bio da luna" })],
};

async function importado() {
  const db = dbComConfig();
  for (const s of MUSICAS_CREATE_STATEMENTS) db.exec(s);
  await importarArtistas(db, { artistas: async () => ABAS.artistas, infosActs: async () => ABAS.infos }, HOJE);
  return db;
}

test("perfil: GET por nome (sem acento/caixa); 404; POST do dono, de outro usuário 403, sem sessão 403; admin troca país", async () => {
  const db = await importado();
  await comPlanilhas(db, ABAS, async (p) => {
    const g = await artistasPerfilController(req("/api/artistas/perfil?nome=raven"));
    expect(g.status).toBe(200);
    expect(((await g.json()) as any).data).toMatchObject({ idUnico: "Raven1198902945", pais: "PORTO RICO", generoPrincipal: "POP" });
    const n = await artistasPerfilController(req("/api/artistas/perfil?nome=ninguem"));
    expect(n.status).toBe(404);
    expect(((await n.json()) as any).error).toBe("Artista não encontrado.");

    const dono = await issueSessionToken("raven", DONO_RAVEN);
    const ok = await artistasPerfilController(req("/api/artistas/perfil", { method: "POST", token: dono, body: { nome: "Raven", biografia: "nova bio", generoPrincipal: "R&B" } }));
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as any).data).toMatchObject({ biografia: "nova bio", generoPrincipal: "R&B" });

    const outro = await issueSessionToken("fulano", "555");
    const r403 = await artistasPerfilController(req("/api/artistas/perfil", { method: "POST", token: outro, body: { nome: "Raven", biografia: "hack" } }));
    expect(r403.status).toBe(403);
    expect(((await r403.json()) as any).error).toBe("Só o dono do artista pode editar.");
    expect((await artistasPerfilController(req("/api/artistas/perfil", { method: "POST", body: { nome: "Raven", biografia: "hack" } }))).status).toBe(403);
    expect((await buscarArtista(db, "raven"))?.biografia).toBe("nova bio");

    // País: dono com país já salvo → 409; mesmo país (outra grafia) → sem erro; admin troca
    const p409 = await artistasPerfilController(req("/api/artistas/perfil", { method: "POST", token: dono, body: { nome: "Raven", pais: "MÉXICO" } }));
    expect(p409.status).toBe(409);
    expect(((await p409.json()) as any).error).toBe("A nacionalidade já foi definida. Peça à administração para alterar.");
    const igual = await artistasPerfilController(req("/api/artistas/perfil", { method: "POST", token: dono, body: { nome: "Raven", pais: "porto rico" } }));
    expect(igual.status).toBe(200);
    const admin = await issueSessionToken("admin", ADMIN_TG_ID);
    const pa = await artistasPerfilController(req("/api/artistas/perfil", { method: "POST", token: admin, body: { nome: "Raven", pais: "mexico" } }));
    expect(pa.status).toBe(200);
    expect((await buscarArtista(db, "raven"))?.pais).toBe("MÉXICO");

    // Cópia para a ARTISTAS (sem ctx: aguardada) com cabeçalho lido sem cache
    expect(p.lidas).toContain("usuarios:ARTISTAS");
    expect(p.lotes.some((l) => l.some((c) => c.range === "R2" && c.valor === "nova bio"))).toBe(true);
    expect(p.lidas.filter((l) => l.endsWith("INFOS ACTS"))).toEqual([]);
  });
});

test("gravarPerfil: dono reenviando o mesmo país (normalizado) não dá 409", async () => {
  const db = await importado();
  const r = await gravarPerfil(db, "Raven1198902945", { pais: "Porto Rico", biografia: "b" }, false, async () => {});
  expect(r.ok).toBe(true);
  if (r.ok) expect(r.artista).toMatchObject({ pais: "PORTO RICO", biografia: "b" });
  const s = await gravarPerfil(db, "Raven1198902945", { pais: "PORTO RICO" }, false, async () => {});
  expect(s.ok).toBe(true);
});

test("endpoints antigos: mesmo formato de resposta, dono confere, gravam no espelho e nunca leem INFOS ACTS", async () => {
  const db = await importado();
  await comPlanilhas(db, ABAS, async (p) => {
    const dono = await issueSessionToken("raven", DONO_RAVEN);
    const bio = await setArtistBiografiaController(req("/api/artistas/biografia", { method: "POST", token: dono, body: { nome: "Raven", biografia: "bio antiga" } }));
    expect(bio.status).toBe(200);
    expect(await bio.json()).toEqual({ success: true });
    const foto = await setArtistFotoController(req("/api/artistas/foto", { method: "POST", token: dono, body: { nome: "raven", fotoUrl: "http://f" } }));
    expect(await foto.json()).toEqual({ success: true });
    const capa = await setArtistCapaController(req("/api/artistas/capa", { method: "POST", token: dono, body: { nome: "Raven", capaMobileUrl: "http://m" } }));
    expect(await capa.json()).toEqual({ success: true });
    const negado = await setArtistBiografiaController(req("/api/artistas/biografia", { method: "POST", body: { nome: "Raven", biografia: "x" } }));
    expect(negado.status).toBe(403);
    expect(await negado.json()).toEqual({ success: false, error: "Só o dono do artista pode editar." });

    const info = await getArtistInfoController(req("/api/artistas/infos?nome=Raven"));
    expect(await info.json()).toEqual({ success: true, data: { foto: "http://f", biografia: "bio antiga", capa: "", capaMobile: "http://m" } });
    const vazio = await getArtistInfoController(req("/api/artistas/infos?nome=Ninguem"));
    expect(await vazio.json()).toEqual({ success: true, data: { foto: "", biografia: "", capa: "", capaMobile: "" } });

    const todos = (await (await getAllArtistasController()).json()) as any;
    const luna = todos.data.find((a: any) => a.nome === "Lúna");
    expect(luna).toMatchObject({ foto: "http://c", descricao: "bio da luna", pais: "ESTADOS UNIDOS" });
    expect(todos.data.find((a: any) => a.nome === "Raven").foto).toBe("http://f");

    const fotos = await buildFotoPorArtista();
    expect(fotos.get("raven")).toBe("http://f");

    expect(p.lidas.filter((l) => l.endsWith("INFOS ACTS"))).toEqual([]);
    expect(p.escritas.filter((l) => l.includes("INFOS ACTS"))).toEqual([]);
  });
});

test("endpoints antigos antes da importação: caminho anterior (INFOS ACTS) só enquanto a marca não existe", async () => {
  const db = dbComConfig();
  await comPlanilhas(db, ABAS, async (p) => {
    const info = await getArtistInfoController(req("/api/artistas/infos?nome=LUNA"));
    expect(((await info.json()) as any).data).toMatchObject({ foto: "http://c", biografia: "bio da luna" });
    expect(p.lidas).toContain("registrosCharts:INFOS ACTS");
  });
});

test("gêneros: espelho ∪ musicas.genero, caixa alta, sem repetição, ordenados", async () => {
  const db = await importado();
  await db.prepare("INSERT INTO musicas (chave, titulo, artista, genero) VALUES ('a', 't', 'x', 'Funk'), ('b', 't', 'x', 'pop'), ('c', 't', 'x', NULL), ('d', 't', 'x', 'alternative/rock')").run();
  await comPlanilhas(db, ABAS, async () => {
    const r = (await (await artistasPerfilController(req("/api/artistas/generos"))).json()) as any;
    expect(r).toEqual({ success: true, data: ["ALTERNATIVE/ROCK", "FUNK", "POP"] });
  });
});

test("admin: importar e atualizar-da-planilha exigem admin; importar copia as células para a ARTISTAS", async () => {
  const db = dbComConfig();
  await comPlanilhas(db, ABAS, async (p) => {
    const outro = await issueSessionToken("fulano", "555");
    const negado = await artistasPerfilController(req("/api/admin/artistas/importar", { method: "POST", token: outro }));
    expect(negado.status).toBe(403);
    expect(await carregarArtistas(db)).toHaveProperty("size", 0);

    const admin = await issueSessionToken("admin", ADMIN_TG_ID);
    const imp = (await (await artistasPerfilController(req("/api/admin/artistas/importar", { method: "POST", token: admin }))).json()) as any;
    expect(imp).toMatchObject({ success: true, data: { total: 2, complementados: 1, copiaPlanilha: "ok" } });
    expect(imp.data.celulas).toBeGreaterThan(0);
    // Luna (linha 3): PAÍS é a coluna U (21ª)
    expect(p.lotes.flat()).toContainEqual({ range: "U3", valor: "ESTADOS UNIDOS" });

    await db.prepare("UPDATE artistas SET biografia = 'editada' WHERE id_unico = 'Raven1198902945'").run();
    limparCacheArtistas();
    const at = (await (await artistasPerfilController(req("/api/admin/artistas/atualizar-da-planilha", { method: "POST", token: admin, body: { idUnico: "Raven1198902945" } }))).json()) as any;
    expect(at.success).toBe(true);
    expect(at.data[0]).toMatchObject({ id: "Raven1198902945" });
    expect(at.data[0].campos).toContain("Biografia");
    const nao = await artistasPerfilController(req("/api/admin/artistas/atualizar-da-planilha", { method: "POST", token: admin, body: { idUnico: "nada" } }));
    expect(nao.status).toBe(404);
  });
});

test("cron: sem marca importa (com cópia); depois reconcilia no máximo 1x por hora", async () => {
  const db = dbComConfig();
  let leiturasArtistas = 0;
  let leiturasInfos = 0;
  const copiadas: number[] = [];
  const deps = {
    fontes: {
      artistas: async () => { leiturasArtistas++; return ABAS.artistas; },
      infosActs: async () => { leiturasInfos++; return ABAS.infos; },
    },
    copiarCelulas: async (c: { linha: number }[]) => { copiadas.push(c.length); return "ok"; },
  };
  const r1 = await rodarCronArtistas(db, HOJE, deps);
  expect(r1).toMatchObject({ acao: "importou", total: 2, copiaPlanilha: "ok" });
  expect(copiadas[0]).toBeGreaterThan(0);
  const r2 = await rodarCronArtistas(db, new Date(HOJE.getTime() + 10 * 60_000), deps);
  expect(r2).toEqual({ acao: "reconciliou", mudancas: 0 });
  const r3 = await rodarCronArtistas(db, new Date(HOJE.getTime() + 30 * 60_000), deps);
  expect(r3).toEqual({ acao: "nada" });
  const r4 = await rodarCronArtistas(db, new Date(HOJE.getTime() + 71 * 60_000), deps);
  expect(r4.acao).toBe("reconciliou");
  expect(leiturasInfos).toBe(1);
  expect(leiturasArtistas).toBe(3);
});

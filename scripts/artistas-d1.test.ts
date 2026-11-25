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

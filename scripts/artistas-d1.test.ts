// Espelho D1 de ARTISTAS. Uso: bun test scripts/artistas-d1.test.ts
import { test, expect, beforeEach } from "bun:test";
import { criarD1Sqlite } from "./charts-d1-sqlite";
import { ARTISTAS_SCHEMA, registroDaLinha, carregarArtistas, buscarArtista, limparCacheArtistas } from "../backend/src/services/artistasD1";

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
  expect(a.idUnico).toBe("Raven1198902945");
  const s = [...RAVEN]; s[0] = "";
  expect(registroDaLinha(CAB, s, 2)).toBeNull();
});

function inserir(db: ReturnType<typeof criarD1Sqlite>, id: string, nome: string, chave: string, linha: number) {
  db.exec(`INSERT INTO artistas (id_unico, nome, nome_chave, linha_planilha, atualizado_em) VALUES ('${id}','${nome}','${chave}',${linha},'x')`);
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

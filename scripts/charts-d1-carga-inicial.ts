// Carga inicial dos charts no D1: lê o CSV da aba DADOS, agrupa por data,
// ordena cronologicamente e envia semana a semana ao /api/charts/ingest
// (modo "historico"). Pula datas já gravadas e para no limite de linhas por
// execução (D1 grátis: 100k escritas/dia, contando índice e tabelas
// derivadas — 25k linhas da aba deixam folga pro resto do app); no dia seguinte é só rodar
// de novo. Com --ativar, quando não sobra nenhuma semana pendente, libera a
// leitura do D1 na tela (antes disso o app segue lendo a planilha).
//
//   CHARTS_INGEST_TOKEN=... bun scripts/charts-d1-carga-inicial.ts \
//     --dados DADOS.csv --pesos PESOS.csv --url https://SEU-APP/api/charts/ingest \
//     [--infos INFOS_ACTS.csv] [--limite 25000] [--ativar]
//   bun scripts/charts-d1-carga-inicial.ts --dados DADOS.csv --pesos PESOS.csv --local [--ativar]   (teste em SQLite local)
import { readFileSync } from "node:fs";
import { dataBrParaIso } from "../backend/src/services/chartsD1/dados";
import type { D1DatabaseLike } from "../backend/src/services/catalogoDbService";
import { ingerirSemana, datasCarregadas, type PayloadIngestao } from "../backend/src/services/chartsD1/repo";

/** Cabeçalho normalizado: minúsculo, sem acentos, pontuação/espaços viram um espaço só. */
const normalizarCabecalho = (s: string): string =>
  (s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Índice da coluna cujo cabeçalho é um de `nomes` (na ordem de preferência); -1 se nenhuma. */
function colunaPorCabecalho(cabecalho: string[], nomes: string[]): number {
  const normalizados = cabecalho.map(normalizarCabecalho);
  for (const n of nomes) {
    const i = normalizados.indexOf(n);
    if (i >= 0) return i;
  }
  return -1;
}

/**
 * CSV da INFOS ACTS (linha 1 = cabeçalho) → payload [nome, nacionalidade, foto, genero?].
 * Mesma regra do EnvioD1.gs: colunas pelo cabeçalho, nome/foto/nacionalidade
 * caem em A/G/N; sem coluna de gênero, linhas de 3 elementos (com aviso).
 */
export function artistasDoCsvInfos(linhas: string[][]): string[][] {
  const cabecalho = linhas[0] ?? [];
  const col = (nomes: string[], padrao: number) => {
    const i = colunaPorCabecalho(cabecalho, nomes);
    return i >= 0 ? i : padrao;
  };
  const cNome = col(["nome", "artista"], 0);
  const cFoto = col(["foto"], 6);
  const cNac = col(["nacionalidade"], 13);
  const cGenero = colunaPorCabecalho(cabecalho, ["genero", "estilo", "genero musical"]);
  if (cGenero < 0) console.warn("AVISO: INFOS ACTS sem coluna de gênero (cabeçalho \"Gênero\"/\"Estilo\"); artistas sem gênero.");
  return linhas
    .slice(1)
    .map((r) => {
      const linha = [r[cNome] ?? "", r[cNac] ?? "", r[cFoto] ?? ""];
      if (cGenero >= 0) linha.push(r[cGenero] ?? "");
      return linha;
    })
    .filter((r) => r[0].trim());
}

/** Parser CSV (RFC 4180): aspas, vírgula e quebra de linha dentro de campo, CRLF ou LF. */
export function lerCsv(texto: string): string[][] {
  const linhas: string[][] = [];
  let linha: string[] = [];
  let campo = "";
  let aspas = false;
  const fechaLinha = () => {
    linha.push(campo);
    campo = "";
    linhas.push(linha);
    linha = [];
  };
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (aspas) {
      if (c === '"') {
        if (texto[i + 1] === '"') { campo += '"'; i++; } else aspas = false;
      } else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === ",") { linha.push(campo); campo = ""; }
    else if (c === "\n") fechaLinha();
    else if (c !== "\r") campo += c;
  }
  if (campo !== "" || linha.length) fechaLinha();
  return linhas;
}

const DATA_BR = /^\d{1,2}\/\d{1,2}\/\d{4}$/;

/**
 * Agrupa por data (ISO), ordena cronologicamente, pula `jaCarregadas` (ISO) e
 * corta no `limite` de linhas sem nunca partir uma semana ao meio.
 */
export function planejarLotes(
  linhas: string[][],
  jaCarregadas: Set<string>,
  limite: number,
): { data: string; linhas: string[][] }[] {
  const porData = new Map<string, string[][]>();
  for (const l of linhas) {
    const data = (l[1] ?? "").trim();
    if (!(l[0] ?? "").trim() || !DATA_BR.test(data)) continue; // cabeçalho, vazias e lixo
    const iso = dataBrParaIso(data);
    if (jaCarregadas.has(iso)) continue;
    (porData.get(iso) ?? porData.set(iso, []).get(iso)!).push(l);
  }
  const lotes: { data: string; linhas: string[][] }[] = [];
  let total = 0;
  for (const data of [...porData.keys()].sort()) {
    const ls = porData.get(data)!;
    if (total + ls.length > limite) break;
    total += ls.length;
    lotes.push({ data, linhas: ls });
  }
  return lotes;
}

function arg(nome: string): string | undefined {
  const i = process.argv.indexOf(`--${nome}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** Linhas de chart_semana gravadas por execução (padrão). */
const LIMITE_PADRAO = 25000;

/** Resumo da carga `--local`: datas, anomalias registradas e #1 do Hot 100 da última semana. */
async function resumoLocal(db: D1DatabaseLike) {
  const all = async <T>(sql: string) => (await db.prepare(sql).all<T>()).results;
  const [{ n }] = await all<{ n: number }>("SELECT COUNT(DISTINCT data) AS n FROM chart_semana");
  const msgs = await all<{ data: string; mensagem: string }>("SELECT data, mensagem FROM chart_ingestao WHERE ok = 1 AND mensagem <> 'ok' AND modo <> 'ativacao' ORDER BY data");
  // iTUNES ignorado é esperado (o app não usa); o resto é anomalia de verdade.
  const anomalias = msgs
    .map((m) => ({ data: m.data, mensagem: m.mensagem.split("; ").filter((p) => !/de iTUNES ignorada/.test(p)).join("; ") }))
    .filter((m) => m.mensagem);
  const falhas = await all<{ n: number }>("SELECT COUNT(*) AS n FROM chart_ingestao WHERE ok = 0");
  console.log(`[local] ${n} datas gravadas, ${anomalias.length} semana(s) com anomalia (fora iTUNES ignorado), ${falhas[0].n} ingestão(ões) recusada(s).`);
  for (const a of anomalias) console.log(`[local] anomalia ${a.data}: ${a.mensagem}`);
  const top = await all<{ data: string; titulo: string }>(
    "SELECT data, titulo FROM chart_semana WHERE chart = 'BILLBOARD HOT 100' AND pos = 1 AND data = (SELECT MAX(data) FROM chart_semana)",
  );
  console.log(`[local] Hot 100 #1 de ${top[0] ? top[0].data.split("-").reverse().join("/") : "(última semana)"}: ${top[0]?.titulo ?? "(sem dados)"}`);
  const ativo = await all<{ valor: string }>("SELECT valor FROM chart_config WHERE chave = 'charts_d1_ativo'");
  console.log(`[local] leitura do D1 ativada: ${ativo[0]?.valor === "1" ? "sim" : "não"}`);
}

/**
 * Medidor da carga `--local`: soma as linhas devolvidas pelos SELECTs (nas
 * consultas da ingestão, que não agregam, é o mesmo que as linhas lidas) e
 * guarda o plano de cada consulta distinta pra apontar varredura de tabela.
 */
function criarMedidor() {
  const m = { linhasLidas: 0, consultas: 0, sqls: new Map<string, unknown[]>() };
  const aoExecutar = (sql: string, params: unknown[], linhas: number) => {
    if (!/^\s*SELECT/i.test(sql)) return;
    m.consultas++;
    m.linhasLidas += linhas;
    if (!m.sqls.has(sql)) m.sqls.set(sql, params);
  };
  return { m, aoExecutar };
}

async function principal() {
  const dadosPath = arg("dados");
  const pesosPath = arg("pesos");
  const local = process.argv.includes("--local");
  const url = arg("url");
  const ativar = process.argv.includes("--ativar");
  const limite = Number(arg("limite") ?? (local ? Infinity : LIMITE_PADRAO)); // --local: sem limite diário
  if (!dadosPath || !pesosPath || (!local && !url)) {
    console.error(`Uso: bun scripts/charts-d1-carga-inicial.ts --dados <DADOS.csv> --pesos <PESOS.csv> (--url <.../api/charts/ingest> | --local) [--infos <INFOS.csv>] [--limite ${LIMITE_PADRAO}] [--ativar]`);
    process.exit(1);
  }
  const token = process.env.CHARTS_INGEST_TOKEN ?? "";
  if (!local && !token) {
    console.error("Defina CHARTS_INGEST_TOKEN no ambiente (não passe o token na linha de comando).");
    process.exit(1);
  }

  const dados = lerCsv(readFileSync(dadosPath, "utf8"));
  const pesos = lerCsv(readFileSync(pesosPath, "utf8")).slice(1).filter((p) => (p[0] ?? "").trim());
  const infosPath = arg("infos");
  const artistas = infosPath ? artistasDoCsvInfos(lerCsv(readFileSync(infosPath, "utf8"))) : undefined;

  let enviar: (p: PayloadIngestao) => Promise<{ ok: boolean; erros?: string[] }>;
  let jaCarregadas: Set<string>;
  let localDb: D1DatabaseLike | undefined;
  const medidor = criarMedidor();
  if (local) {
    const { criarD1Sqlite } = await import("./charts-d1-sqlite");
    const db = criarD1Sqlite(":memory:", medidor.aoExecutar);
    localDb = db;
    jaCarregadas = new Set(await datasCarregadas(db).catch(() => []));
    enviar = (p) => ingerirSemana(db, p);
  } else {
    const cab = { Authorization: `Bearer ${token}` };
    const r = await fetch(url!, { headers: cab });
    const j = (await r.json().catch(() => null)) as { ok?: boolean; datas?: string[]; erros?: string[] } | null;
    if (!r.ok || !j?.ok) {
      console.error(`Falha ao consultar datas já gravadas (HTTP ${r.status}): ${j?.erros?.join("; ") ?? "resposta inesperada"}`);
      process.exit(1);
    }
    jaCarregadas = new Set(j.datas);
    enviar = async (p) => {
      try {
        const post = () => fetch(url!, { method: "POST", headers: { ...cab, "Content-Type": "application/json" }, body: JSON.stringify(p) });
        let resp = await post();
        // 5xx passageiro do Worker/D1 (ex.: 503): espera e tenta mais uma vez antes de dar erro.
        if (resp.status >= 500) { await new Promise((ok) => setTimeout(ok, 5000)); resp = await post(); }
        return (await resp.json().catch(() => ({ ok: false, erros: [`HTTP ${resp.status} sem JSON`] }))) as { ok: boolean; erros?: string[] };
      } catch (e) {
        return { ok: false, erros: [`falha de rede: ${e instanceof Error ? e.message : String(e)}`] };
      }
    };
  }

  const lotes = planejarLotes(dados, jaCarregadas, limite);
  const totalDatas = new Set(dados.filter((l) => DATA_BR.test((l[1] ?? "").trim())).map((l) => dataBrParaIso(l[1]))).size;
  console.log(`${totalDatas} datas no CSV, ${jaCarregadas.size} já gravadas, ${lotes.length} a enviar (limite ${limite} linhas).`);

  if (!lotes.length) {
    const primeira = planejarLotes(dados, jaCarregadas, Infinity)[0];
    if (primeira) console.warn(`AVISO: a primeira semana pendente (${primeira.data}) tem ${primeira.linhas.length} linhas, mais que o --limite ${limite}. Aumente o limite.`);
  }
  let enviadas = 0;
  let erros = 0;
  const gravadas = new Set<string>();
  let primeiro = true; // pesos e artistas vão no primeiro POST que der certo
  for (const lote of lotes) {
    const payload: PayloadIngestao = { linhas: lote.linhas, modo: "historico" };
    if (primeiro) { payload.pesos = pesos; if (artistas) payload.artistas = artistas; }
    const r = await enviar(payload);
    if (r.ok) { primeiro = false; gravadas.add(lote.data); enviadas += lote.linhas.length; console.log(`ok ${lote.data} (${lote.linhas.length} linhas)`); }
    else { erros++; console.error(`ERRO ${lote.data}: ${(r.erros ?? []).join("; ")}`); }
  }

  // Semanas que falharam continuam pendentes (são tentadas de novo na próxima execução).
  const restantes = planejarLotes(dados, new Set([...jaCarregadas, ...gravadas]), Infinity).length;
  console.log(`Concluído: ${gravadas.size} semana(s) gravada(s), ${enviadas} linhas, ${erros} erro(s).`);
  if (restantes > 0) console.log(`Faltam ${restantes} semana(s): retome amanhã rodando o mesmo comando (as que deram erro entram de novo).`);
  if (ativar) {
    if (restantes > 0) console.log("--ativar: ainda há semanas pendentes; a leitura do D1 continua desligada (o app lê a planilha).");
    else {
      const r = await enviar({ ativar: true });
      if (r.ok) console.log("Leitura do D1 ativada: o app passa a ler os charts do D1.");
      else { erros++; console.error(`ERRO ao ativar a leitura do D1: ${(r.erros ?? []).join("; ")}`); }
    }
  }
  if (localDb) {
    const m = medidor.m;
    console.log(`[local] ${m.consultas} consultas SELECT, ${m.linhasLidas} linhas lidas na carga (${m.sqls.size} consultas distintas).`);
    for (const [sql, params] of m.sqls) {
      const plano = (await localDb.prepare(`EXPLAIN QUERY PLAN ${sql}`).bind(...params).all<{ detail: string }>()).results.map((p) => p.detail);
      if (plano.some((d) => /^SCAN chart_/.test(d))) console.warn(`[local] VARREDURA: ${sql.replace(/\s+/g, " ").slice(0, 120)} => ${plano.join(" | ")}`);
    }
    await resumoLocal(localDb);
  }
  if (erros) process.exitCode = 1;
}

if (import.meta.main) await principal();

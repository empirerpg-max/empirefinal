// Carga inicial dos charts no D1: lê o CSV da aba DADOS, agrupa por data,
// ordena cronologicamente e envia semana a semana ao /api/charts/ingest
// (modo "historico"). Pula datas já gravadas e para no limite diário de
// linhas (D1 grátis: ~45k/dia); no dia seguinte é só rodar de novo.
//
//   CHARTS_INGEST_TOKEN=... bun scripts/charts-d1-carga-inicial.ts \
//     --dados DADOS.csv --pesos PESOS.csv --url https://SEU-APP/api/charts/ingest \
//     [--infos INFOS_ACTS.csv] [--limite 45000]
//   bun scripts/charts-d1-carga-inicial.ts --dados DADOS.csv --pesos PESOS.csv --local   (teste em SQLite local)
import { readFileSync } from "node:fs";
import { dataBrParaIso } from "../backend/src/services/chartsD1/dados";
import type { D1DatabaseLike } from "../backend/src/services/catalogoDbService";
import { ingerirSemana, datasCarregadas, type PayloadIngestao } from "../backend/src/services/chartsD1/repo";

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

/** Resumo da carga `--local`: datas, anomalias registradas e #1 do Hot 100 da última semana. */
async function resumoLocal(db: D1DatabaseLike) {
  const all = async <T>(sql: string) => (await db.prepare(sql).all<T>()).results;
  const [{ n }] = await all<{ n: number }>("SELECT COUNT(DISTINCT data) AS n FROM chart_semana");
  const msgs = await all<{ data: string; mensagem: string }>("SELECT data, mensagem FROM chart_ingestao WHERE ok = 1 AND mensagem <> 'ok' ORDER BY data");
  // iTUNES ignorado é esperado (o app não usa); o resto é anomalia de verdade.
  const anomalias = msgs
    .map((m) => ({ data: m.data, mensagem: m.mensagem.split("; ").filter((p) => !/de iTUNES ignorada/.test(p)).join("; ") }))
    .filter((m) => m.mensagem);
  const falhas = await all<{ n: number }>("SELECT COUNT(*) AS n FROM chart_ingestao WHERE ok = 0");
  console.log(`[local] ${n} datas gravadas, ${anomalias.length} semana(s) com anomalia (fora iTUNES ignorado), ${falhas[0].n} ingestão(ões) recusada(s).`);
  for (const a of anomalias) console.log(`[local] anomalia ${a.data}: ${a.mensagem}`);
  const top = await all<{ data: string; titulo: string }>(
    "SELECT data, titulo FROM chart_semana WHERE chart = 'BILLBOARD HOT 100' AND pos = 1 AND data = '2026-11-11'",
  );
  console.log(`[local] Hot 100 #1 de 11/11/2026: ${top[0]?.titulo ?? "(sem dados)"}`);
}

async function principal() {
  const dadosPath = arg("dados");
  const pesosPath = arg("pesos");
  const local = process.argv.includes("--local");
  const url = arg("url");
  const limite = Number(arg("limite") ?? (local ? Infinity : 45000)); // --local: sem limite diário
  if (!dadosPath || !pesosPath || (!local && !url)) {
    console.error("Uso: bun scripts/charts-d1-carga-inicial.ts --dados <DADOS.csv> --pesos <PESOS.csv> (--url <.../api/charts/ingest> | --local) [--infos <INFOS.csv>] [--limite 45000]");
    process.exit(1);
  }
  const token = process.env.CHARTS_INGEST_TOKEN ?? "";
  if (!local && !token) {
    console.error("Defina CHARTS_INGEST_TOKEN no ambiente (não passe o token na linha de comando).");
    process.exit(1);
  }

  const dados = lerCsv(readFileSync(dadosPath, "utf8"));
  const pesos = lerCsv(readFileSync(pesosPath, "utf8")).slice(1).filter((p) => (p[0] ?? "").trim());
  // INFOS ACTS: col A nome, G foto, N nacionalidade → payload [nome, nacionalidade, foto]
  const infosPath = arg("infos");
  const artistas = infosPath
    ? lerCsv(readFileSync(infosPath, "utf8")).slice(1).map((r) => [r[0] ?? "", r[13] ?? "", r[6] ?? ""]).filter((r) => r[0].trim())
    : undefined;

  let enviar: (p: PayloadIngestao) => Promise<{ ok: boolean; erros?: string[] }>;
  let jaCarregadas: Set<string>;
  let localDb: D1DatabaseLike | undefined;
  if (local) {
    const { criarD1Sqlite } = await import("./charts-d1-sqlite");
    const db = criarD1Sqlite();
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
      const resp = await fetch(url!, { method: "POST", headers: { ...cab, "Content-Type": "application/json" }, body: JSON.stringify(p) });
      return (await resp.json().catch(() => ({ ok: false, erros: [`HTTP ${resp.status} sem JSON`] }))) as { ok: boolean; erros?: string[] };
    };
  }

  const lotes = planejarLotes(dados, jaCarregadas, limite);
  const totalDatas = new Set(dados.filter((l) => DATA_BR.test((l[1] ?? "").trim())).map((l) => dataBrParaIso(l[1]))).size;
  console.log(`${totalDatas} datas no CSV, ${jaCarregadas.size} já gravadas, ${lotes.length} a enviar (limite ${limite} linhas).`);

  let enviadas = 0;
  let erros = 0;
  let primeiro = true; // pesos e artistas vão no primeiro POST que der certo
  for (const lote of lotes) {
    const payload: PayloadIngestao = { linhas: lote.linhas, modo: "historico" };
    if (primeiro) { payload.pesos = pesos; if (artistas) payload.artistas = artistas; }
    const r = await enviar(payload);
    if (r.ok) { primeiro = false; enviadas += lote.linhas.length; console.log(`ok ${lote.data} (${lote.linhas.length} linhas)`); }
    else { erros++; console.error(`ERRO ${lote.data}: ${(r.erros ?? []).join("; ")}`); }
  }

  const restantes = planejarLotes(dados, new Set([...jaCarregadas, ...lotes.map((l) => l.data)]), Infinity).length;
  console.log(`Concluído: ${lotes.length - erros} semana(s) gravada(s), ${enviadas} linhas, ${erros} erro(s).`);
  if (restantes > 0) console.log(`Faltam ${restantes} semana(s): atingiu o limite diário, retome amanhã rodando o mesmo comando.`);
  if (localDb) await resumoLocal(localDb);
  if (erros) process.exitCode = 1;
}

if (import.meta.main) await principal();

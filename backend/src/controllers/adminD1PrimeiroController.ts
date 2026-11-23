// Admin do catálogo "D1 primeiro" (spec docs/superpowers/specs/2026-11-18-catalogo-d1-primeiro-design.md):
// carga inicial (planilha real -> planilha virtual, conferida célula a
// célula), ligar/desligar cada aba, status e verificação de integridade.
// Nunca copia a planilha para o D1 de uma aba já ligada.
import { getCatalogoDb } from "../services/catalogoDbService";
import { googleDireto } from "../services/googleSheetsService";
import { registrarLogSistema } from "../services/logSistemaService";
import { substituirAba, indiceParaColuna } from "../services/planilhaVirtualD1";
import {
  ABAS_D1_PRIMEIRO_FASE1,
  PLANILHA_PRINCIPAL_ID as P,
  definirEstadoAba,
  estadoAba,
  estadoAbaSemCache,
  garantirTabelas,
  lerD1,
  type EstadoAba,
} from "../services/porteiroD1";
import { despacharFila } from "../services/despachanteFilaBackup";
import { requestProvesAdmin } from "../services/sessionService";

type Aba = (typeof ABAS_D1_PRIMEIRO_FASE1)[number];
const ehAba = (a: string): a is Aba => (ABAS_D1_PRIMEIRO_FASE1 as readonly string[]).includes(a);

function db() {
  const d = getCatalogoDb();
  if (!d) throw new Error("Banco do catálogo (D1) indisponível.");
  return d;
}

async function pendentesDaAba(aba: string): Promise<number> {
  await garantirTabelas();
  const r = await db().prepare("SELECT count(*) AS n FROM fila_backup_planilha WHERE planilha = ? AND aba = ?").bind(P, aba).all<{ n: number }>();
  return r.results?.[0]?.n ?? 0;
}

async function linhasNoD1(aba: string): Promise<number> {
  await garantirTabelas();
  const r = await db().prepare("SELECT count(*) AS n FROM planilha_virtual WHERE planilha = ? AND aba = ?").bind(P, aba).all<{ n: number }>();
  return r.results?.[0]?.n ?? 0;
}

const abaInexistente = (err: unknown) => /unable to parse range/i.test(err instanceof Error ? err.message : String(err));

async function lerPlanilhaReal(aba: string, formulas = false): Promise<string[][]> {
  try {
    return formulas ? await googleDireto.lerFormulas(P, aba) : await googleDireto.readValuesFresh(P, aba);
  } catch (err) {
    if (abaInexistente(err)) return [];
    throw err;
  }
}

const aparar = (rows: string[][]) => {
  const out = rows.map((r) => {
    const c = r.map((v) => (v == null ? "" : String(v)));
    while (c.length && c[c.length - 1] === "") c.pop();
    return c;
  });
  while (out.length && out[out.length - 1].length === 0) out.pop();
  return out;
};

function linhasDiferentes(a: string[][], b: string[][]): number[] {
  const x = aparar(a);
  const y = aparar(b);
  const out: number[] = [];
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if (JSON.stringify(x[i] ?? []) !== JSON.stringify(y[i] ?? [])) out.push(i + 1);
  }
  return out;
}

export type ResultadoCarga =
  | { ok: true; linhas: number }
  | {
      ok: false;
      motivo: "aba-invalida" | "ja-ligada" | "fila-pendente" | "formula" | "divergencia" | "erro";
      celulas?: string[];
      linhas?: number[];
      erro?: string;
    };

// Espera padrão das transições: o estado de cada aba fica em cache por 30 s
// em cada servidor; esperando 31 s todos já viram a mudança (o estado mora
// no D1, consistente na hora — sem o atraso de propagação do KV).
const ESPERA_TRANSICAO_MS = 31_000;

export async function carregarAba(aba: string, opts: { esperaMs?: number } = {}): Promise<ResultadoCarga> {
  if (!ehAba(aba)) return { ok: false, motivo: "aba-invalida" };
  // Nunca recopia a planilha por cima de uma aba que já tem o D1 como
  // verdade (revisão I5) — lido sem cache.
  if ((await estadoAbaSemCache(aba)) !== "off") return { ok: false, motivo: "ja-ligada" };
  if ((await pendentesDaAba(aba)) > 0) return { ok: false, motivo: "fila-pendente" };
  await definirEstadoAba(aba, "carregando");
  try {
    // Espera todos os servidores verem "carregando" (gravações recusadas)
    // antes de copiar a planilha.
    const espera = opts.esperaMs ?? ESPERA_TRANSICAO_MS;
    if (espera > 0) await new Promise((r) => setTimeout(r, espera));

    const formulas = await lerPlanilhaReal(aba, true);
    const celulas: string[] = [];
    formulas.forEach((row, i) =>
      row.forEach((v, j) => {
        if (typeof v === "string" && v.startsWith("=")) celulas.push(`${indiceParaColuna(j)}${i + 1}`);
      }),
    );
    if (celulas.length) {
      await definirEstadoAba(aba, "off");
      return { ok: false, motivo: "formula", celulas };
    }

    const linhas = await lerPlanilhaReal(aba);
    await db().batch(await substituirAba(P, aba, linhas));
    const diferentes = linhasDiferentes(linhas, await lerD1(P, aba));
    if (diferentes.length) {
      await definirEstadoAba(aba, "off");
      return { ok: false, motivo: "divergencia", linhas: diferentes };
    }
    await definirEstadoAba(aba, "on");
    await registrarLogSistema({
      categoria: "Ação concluída",
      oQueAconteceu: `Aba "${aba}" passou a ser lida e gravada no D1 (planilha vira backup). ${linhas.length} linha(s) copiadas.`,
      onde: "carregarAba",
    }).catch(() => {});
    return { ok: true, linhas: linhas.length };
  } catch (err) {
    await definirEstadoAba(aba, "off");
    return { ok: false, motivo: "erro", erro: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Volta a aba para a planilha real com segurança (revisão C2): pausa as
 * gravações (leituras seguem no D1), espera todos os servidores verem,
 * esvazia a fila na planilha e confere planilha x D1. Só então "off".
 * Qualquer problema volta para "on" — o D1 continua sendo a verdade.
 */
export async function desligarAba(
  aba: string,
  opts: { esperaMs?: number } = {},
): Promise<{ ok: true } | { ok: false; motivo: string; pendentes?: number; linhas?: number[]; erro?: string }> {
  if (!ehAba(aba)) return { ok: false, motivo: "aba-invalida" };
  const atual = await estadoAbaSemCache(aba);
  if (atual === "off") return { ok: true };
  if (atual === "carregando") return { ok: false, motivo: "carregando" };
  await definirEstadoAba(aba, "pausado");
  try {
    const espera = opts.esperaMs ?? ESPERA_TRANSICAO_MS;
    if (espera > 0) await new Promise((r) => setTimeout(r, espera));
    for (let i = 0; i < 5 && (await pendentesDaAba(aba)) > 0; i++) {
      const r = await despacharFila();
      if (r.parouPorLimite) break;
    }
    const pendentes = await pendentesDaAba(aba);
    if (pendentes > 0) {
      await definirEstadoAba(aba, "on");
      return { ok: false, motivo: "fila-pendente", pendentes };
    }
    const diferentes = linhasDiferentes(await lerPlanilhaReal(aba), await lerD1(P, aba));
    if (diferentes.length) {
      await definirEstadoAba(aba, "on");
      return { ok: false, motivo: "divergencia", linhas: diferentes };
    }
    await definirEstadoAba(aba, "off");
    return { ok: true };
  } catch (err) {
    await definirEstadoAba(aba, "on");
    return { ok: false, motivo: "erro", erro: err instanceof Error ? err.message : String(err) };
  }
}

export async function statusAbas(): Promise<{ aba: string; estado: EstadoAba; pendentesFila: number; linhasD1: number }[]> {
  const out = [];
  for (const aba of ABAS_D1_PRIMEIRO_FASE1) {
    out.push({ aba, estado: await estadoAba(P, aba), pendentesFila: await pendentesDaAba(aba), linhasD1: await linhasNoD1(aba) });
  }
  return out;
}

/** Compara D1 x planilha real das abas ligadas com fila vazia. Nunca grava no D1. */
export async function verificarIntegridade(): Promise<{ aba: string; ok: boolean; diferentes: number[] }[]> {
  const out = [];
  for (const aba of ABAS_D1_PRIMEIRO_FASE1) {
    if ((await estadoAba(P, aba)) !== "on" || (await pendentesDaAba(aba)) > 0) continue;
    const diferentes = linhasDiferentes(await lerPlanilhaReal(aba), await lerD1(P, aba));
    out.push({ aba, ok: diferentes.length === 0, diferentes });
    if (diferentes.length) {
      await registrarLogSistema({
        categoria: "Erro do app",
        oQueAconteceu: `Backup da aba "${aba}" na planilha difere do D1 (fonte de verdade) nas linhas ${diferentes.slice(0, 20).join(", ")}${diferentes.length > 20 ? "…" : ""}. O D1 NÃO foi alterado.`,
        onde: "verificarIntegridade",
      }).catch(() => {});
    }
  }
  return out;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** Rotas /api/admin/d1primeiro/* — todas só para admin. */
export async function adminD1PrimeiroController(request: Request, acao: string): Promise<Response> {
  if (!(await requestProvesAdmin(request))) return json({ success: false, error: "Acesso restrito ao admin." }, 403);
  try {
    if (acao === "status") return json({ success: true, data: { abas: await statusAbas() } });
    if (request.method !== "POST") return json({ success: false, error: "Use POST." }, 405);
    if (acao === "verificar") return json({ success: true, data: await verificarIntegridade() });
    const { aba } = (await request.json().catch(() => ({}))) as { aba?: string };
    if (acao === "carregar") return json({ success: true, data: await carregarAba(aba || "") });
    if (acao === "desligar") return json({ success: true, data: await desligarAba(aba || "") });
    return json({ success: false, error: "Ação desconhecida." }, 404);
  } catch (err) {
    return json({ success: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

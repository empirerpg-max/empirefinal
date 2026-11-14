// POST /api/charts/ingest — recebe a semana da aba DADOS empurrada pelo
// Google (script EnvioD1) e grava no D1. Protegido por
// `Authorization: Bearer <CHARTS_INGEST_TOKEN>` (secret do Worker).
import { readRuntimeEnv } from "../google/service-account";
import { getCatalogoDb } from "../services/catalogoDbService";
import { ingerirSemana, type PayloadIngestao } from "../services/chartsD1/repo";
import { limparCacheCharts } from "./chartsController";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });

/** Comparação em tempo constante (não vaza, pelo tempo de resposta, quanto do token bateu). */
function tokensIguais(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  let dif = ea.length ^ eb.length;
  for (let i = 0; i < ea.length; i++) dif |= ea[i] ^ (eb[i % (eb.length || 1)] ?? 0);
  return dif === 0;
}

export async function chartsIngestController(request: Request): Promise<Response> {
  if (request.method !== "POST") return json(405, { ok: false, erros: ["Use POST para /api/charts/ingest."] });

  const token = readRuntimeEnv("CHARTS_INGEST_TOKEN").trim();
  const recebido = (request.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  // Sem secret configurado, ninguém entra (nunca aceitar token vazio).
  if (!token || !recebido || !tokensIguais(recebido, token)) return json(401, { ok: false, erros: ["não autorizado"] });

  const db = getCatalogoDb();
  if (!db) return json(503, { ok: false, erros: ["banco D1 (CATALOGO_DB) indisponível"] });

  let payload: PayloadIngestao;
  try {
    payload = (await request.json()) as PayloadIngestao;
  } catch {
    return json(400, { ok: false, erros: ["corpo JSON inválido"] });
  }
  if (!payload || !Array.isArray(payload.linhas)) return json(400, { ok: false, erros: ["campo `linhas` ausente"] });

  try {
    const r = await ingerirSemana(db, payload);
    if (!r.ok) return json(400, r);
    limparCacheCharts();
    return json(200, r);
  } catch (e) {
    console.warn("[charts-ingest] falha ao gravar no D1:", e);
    return json(500, { ok: false, erros: [`falha ao gravar no D1: ${e instanceof Error ? e.message : String(e)}`] });
  }
}

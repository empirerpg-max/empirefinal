// Medição de uso: recebe lotes de contagens (POST /api/uso) e devolve o resumo
// para o admin (GET /api/uso/resumo). Guarda 90 dias; limpeza diária no cron.
import { verifySessionToken, extractBearerToken, requestProvesAdmin } from "../services/sessionService";
import { getCatalogoDb } from "../services/catalogoDbService";
import {
  garantirTabelasUso,
  limparLote,
  gravarLoteUso,
  resumoUso,
  apagarUsoAntigo,
  diaUTC,
} from "../services/usoService";

interface FlagsKvLike {
  get(key: string): Promise<string | null>;
  put?(key: string, value: string): Promise<void>;
}

const USO_LIMPEZA_KV_KEY = "uso-limpeza-dia";
const DIAS_GUARDAR_USO = 90;
const DIA_MS = 86400_000;

const json = (corpo: unknown, status = 200): Response =>
  new Response(JSON.stringify(corpo), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });

/** Chave `medicaoUso.enabled` do KV `home-config`: só `false` desliga (ausente/erro = ligada). */
export async function medicaoUsoLigada(flags: FlagsKvLike | undefined): Promise<boolean> {
  try {
    if (!flags) return true;
    const raw = await flags.get("home-config");
    if (!raw) return true;
    const cfg = JSON.parse(raw) as { medicaoUso?: { enabled?: unknown } } | null;
    return cfg?.medicaoUso?.enabled !== false;
  } catch {
    return true;
  }
}

export async function registrarUsoController(request: Request): Promise<Response> {
  const db = getCatalogoDb();
  if (!db) return json({ ok: false, erro: "Banco indisponível." }, 503);
  const flags = (globalThis as Record<string, unknown>).__FLAGS_KV__ as FlagsKvLike | undefined;
  if (!(await medicaoUsoLigada(flags))) return json({ ok: true, ativo: false });

  let corpo: unknown;
  try {
    corpo = JSON.parse(await request.text());
  } catch {
    return json({ ok: false }, 400);
  }
  const lote = limparLote(corpo);
  if (!lote) return json({ ok: false }, 400);

  try {
    // Jogador: cabeçalho; o sendBeacon não manda cabeçalho, então aceita `token` no corpo.
    // O token nunca é guardado.
    let jogadorId: string | null = null;
    const doCabecalho = await verifySessionToken(extractBearerToken(request));
    if (doCabecalho?.id) jogadorId = doCabecalho.id;
    else {
      const tokenCorpo = (corpo as { token?: unknown }).token;
      if (typeof tokenCorpo === "string" && tokenCorpo) {
        jogadorId = (await verifySessionToken(tokenCorpo))?.id ?? null;
      }
    }
    await garantirTabelasUso(db);
    const { gravadas } = await gravarLoteUso(db, lote, jogadorId, Date.now());
    return json({ ok: true, ativo: true, gravadas });
  } catch (err) {
    console.warn("[registrarUsoController] Falhou:", err);
    return json({ ok: false, erro: "Falha ao gravar." }, 500);
  }
}

const DIA_RE = /^\d{4}-\d{2}-\d{2}$/;
const diaValido = (s: string | null): s is string => !!s && DIA_RE.test(s) && diaUTC(Date.parse(s + "T00:00:00Z")) === s;

export async function resumoUsoController(request: Request): Promise<Response> {
  if (!(await requestProvesAdmin(request))) return json({ ok: false, erro: "Só para admin." }, 403);
  const url = new URL(request.url);
  const de = url.searchParams.get("de");
  const ate = url.searchParams.get("ate");
  if (!diaValido(de) || !diaValido(ate) || de > ate) return json({ ok: false, erro: "Período inválido." }, 400);
  const dias = (Date.parse(ate + "T00:00:00Z") - Date.parse(de + "T00:00:00Z")) / DIA_MS + 1;
  if (dias > DIAS_GUARDAR_USO) return json({ ok: false, erro: "Período máximo: 90 dias." }, 400);
  const db = getCatalogoDb();
  if (!db) return json({ ok: false, erro: "Banco indisponível." }, 503);
  try {
    await garantirTabelasUso(db);
    return json({ ok: true, ...(await resumoUso(db, de, ate)) });
  } catch (err) {
    console.warn("[resumoUsoController] Falhou:", err);
    return json({ ok: false, erro: "Falha ao ler." }, 500);
  }
}

/**
 * Apaga do D1 o uso com mais de 90 dias, no máximo 1x por dia UTC (último dia
 * guardado no KV FLAGS). Devolve quantas linhas apagou, ou null se não rodou
 * (já rodou hoje, sem D1/KV ou erro). Nunca lança.
 */
export async function limparUsoDiaria(
  flags: (FlagsKvLike & { put(key: string, value: string): Promise<void> }) | undefined,
  agoraMs: number = Date.now(),
): Promise<number | null> {
  try {
    const db = getCatalogoDb();
    if (!db || !flags) return null;
    const dia = diaUTC(agoraMs);
    if ((await flags.get(USO_LIMPEZA_KV_KEY)) === dia) return null;
    await garantirTabelasUso(db);
    const apagadas = await apagarUsoAntigo(db, diaUTC(agoraMs - DIAS_GUARDAR_USO * DIA_MS));
    await flags.put(USO_LIMPEZA_KV_KEY, dia);
    return apagadas;
  } catch (err) {
    console.warn("[limparUsoDiaria] Falhou:", err);
    return null;
  }
}

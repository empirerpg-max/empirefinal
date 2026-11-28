// Beta test: estado/escolha de versão por jogador, reportes e chave do admin.
// Config no KV (`beta-config`); escolha e reportes no D1 (betaService).
import { verifySessionToken, extractBearerToken, requestProvesAdmin, ADMIN_TG_ID } from "../services/sessionService";
import { getCatalogoDb } from "../services/catalogoDbService";
import {
  garantirTabelasBeta,
  lerEscolha,
  gravarEscolha,
  criarReporte,
  listarReportes,
  mudarStatusReporte,
  type StatusReporte,
} from "../services/betaService";
import {
  estadoBeta,
  lerConfigBeta,
  CONFIG_BETA_PADRAO,
  MOTIVOS_VOLTA,
  ROTULO_MOTIVO,
  type ConfigBeta,
  type MotivoVolta,
  type Versao,
} from "../../../src/lib/beta/regras";
import { registrarNotificacao } from "./notificacoesController";

interface FlagsKvLike {
  get(key: string): Promise<string | null>;
  put?(key: string, value: string): Promise<void>;
}

const KV_KEY = "beta-config";
const CACHE_CONFIG_MS = 60_000;
const POR_PAGINA = 20;
const STATUS_VALIDOS: readonly string[] = ["novo", "visto", "resolvido"];

const json = (corpo: unknown, status = 200): Response =>
  new Response(JSON.stringify(corpo), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });

const SO_ADMIN = () => json({ ok: false, erro: "Só o admin." }, 403);
const SEM_BANCO = () => json({ ok: false, erro: "Banco indisponível." }, 503);

const getKv = (): FlagsKvLike | undefined =>
  (globalThis as Record<string, unknown>).__FLAGS_KV__ as FlagsKvLike | undefined;

// Cache da config por isolate (60 s): o app consulta o estado a cada abertura.
let cacheConfig: { valor: ConfigBeta; em: number } | null = null;

/** Zera o cache da config (testes e POST de config). */
export function _zerarCacheConfigBeta(): void {
  cacheConfig = null;
}

async function lerConfig(): Promise<ConfigBeta> {
  const agora = Date.now();
  if (cacheConfig && agora - cacheConfig.em < CACHE_CONFIG_MS) return cacheConfig.valor;
  let valor: ConfigBeta;
  try {
    const kv = getKv();
    valor = kv ? lerConfigBeta(await kv.get(KV_KEY)) : { ...CONFIG_BETA_PADRAO, convidados: [] };
  } catch {
    valor = { ...CONFIG_BETA_PADRAO, convidados: [] };
  }
  cacheConfig = { valor, em: agora };
  return valor;
}

async function lerCorpo(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const o = JSON.parse(await request.text());
    return o && typeof o === "object" && !Array.isArray(o) ? (o as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const semArroba = (s: string): string => s.trim().replace(/^@+/, "").toLowerCase();

function ehConvidado(cfg: ConfigBeta, id: string, usuario: string): boolean {
  const alvos = [semArroba(id), semArroba(usuario)].filter(Boolean);
  return cfg.convidados.some((c) => alvos.includes(semArroba(c)));
}

async function estadoDe(sessao: { id: string; usuario: string }, db: NonNullable<ReturnType<typeof getCatalogoDb>>) {
  const cfg = await lerConfig();
  const escolha = await lerEscolha(db, sessao.id);
  const est = estadoBeta({
    modo: cfg.modo,
    convidado: ehConvidado(cfg, sessao.id, sessao.usuario),
    admin: sessao.id.trim() === ADMIN_TG_ID,
    escolha: escolha.versao,
  });
  return { cfg, escolha, est };
}

export async function betaEstadoController(request: Request): Promise<Response> {
  const sessao = await verifySessionToken(extractBearerToken(request));
  if (!sessao?.id) {
    const cfg = await lerConfig();
    return json({ ok: true, modo: cfg.modo, podeVer: false, podeVoltar: false, versao: "anterior", boasVindasVistas: true });
  }
  const db = getCatalogoDb();
  if (!db) return SEM_BANCO();
  try {
    await garantirTabelasBeta(db);
    const { cfg, escolha, est } = await estadoDe(sessao, db);
    return json({ ok: true, modo: cfg.modo, ...est, boasVindasVistas: escolha.boasVindasEm !== null });
  } catch (err) {
    console.warn("[betaEstadoController] Falhou:", err);
    return json({ ok: false, erro: "Falha ao ler." }, 500);
  }
}

/** Monta o reporte limpo (cortes e validações) e grava; avisa o admin sem esperar. */
async function gravarReporte(
  db: NonNullable<ReturnType<typeof getCatalogoDb>>,
  sessao: { id: string; usuario: string },
  c: { texto: string; tela: string; rota: string; versao: Versao; motivo: MotivoVolta | null; printUrl: string; tecnico: string },
): Promise<{ id: string } | { erro: "limite" }> {
  const printUrl = c.printUrl.startsWith("https://") ? c.printUrl.slice(0, 500) : "";
  const tela = c.tela.slice(0, 120);
  const r = await criarReporte(
    db,
    {
      jogadorId: sessao.id,
      usuario: sessao.usuario,
      versao: c.versao,
      tela,
      rota: c.rota.split("?")[0].slice(0, 300),
      texto: c.texto,
      motivo: c.motivo,
      printUrl,
      tecnico: c.tecnico,
    },
    Date.now(),
  );
  if ("id" in r) {
    // Aviso ao admin: sem esperar e sem derrubar o reporte.
    try {
      void Promise.resolve(
        registrarNotificacao({
          evento: "reporte_beta",
          ownerId: ADMIN_TG_ID,
          autorId: sessao.id,
          autorNome: sessao.usuario,
          tipoMedia: "beta",
          tituloMedia: tela,
          topicId: r.id,
          comentario: c.texto,
        }),
      ).catch(() => {});
    } catch {
      /* ignora */
    }
  }
  return r;
}

export async function betaEscolhaController(request: Request): Promise<Response> {
  const sessao = await verifySessionToken(extractBearerToken(request));
  if (!sessao?.id) return json({ ok: false, erro: "Entre na sua conta." }, 401);
  const corpo = await lerCorpo(request);
  const versao = corpo?.versao;
  if (!corpo || (versao !== "beta" && versao !== "anterior")) return json({ ok: false, erro: "Versão inválida." }, 400);
  const db = getCatalogoDb();
  if (!db) return SEM_BANCO();
  try {
    await garantirTabelasBeta(db);
    const { est } = await estadoDe(sessao, db);
    if (versao === "anterior" && !est.podeVoltar) return json({ ok: false, erro: "Não é possível voltar agora." }, 409);
    if (versao === "beta" && !est.podeVer) return json({ ok: false, erro: "O Beta não está liberado para você." }, 403);
    await gravarEscolha(db, sessao.id, versao, Date.now());
    const motivo = (MOTIVOS_VOLTA as readonly string[]).includes(str(corpo.motivo)) ? (str(corpo.motivo) as MotivoVolta) : null;
    const texto = str(corpo.texto).trim();
    if (motivo || texto) {
      // Reporte de quem trocou de versão: versao = a que estava usando antes da troca.
      await gravarReporte(db, sessao, {
        texto: texto || (motivo ? ROTULO_MOTIVO[motivo] : ""),
        tela: str(corpo.tela),
        rota: str(corpo.rota),
        versao: versao === "anterior" ? "beta" : "anterior",
        motivo,
        printUrl: "",
        tecnico: "",
      });
    }
    return json({ ok: true, versao });
  } catch (err) {
    console.warn("[betaEscolhaController] Falhou:", err);
    return json({ ok: false, erro: "Falha ao gravar." }, 500);
  }
}

export async function betaReporteController(request: Request): Promise<Response> {
  const sessao = await verifySessionToken(extractBearerToken(request));
  if (!sessao?.id) return json({ ok: false, erro: "Entre na sua conta." }, 401);
  const corpo = await lerCorpo(request);
  if (!corpo) return json({ ok: false, erro: "Pedido inválido." }, 400);
  const texto = str(corpo.texto).trim();
  if (!texto) return json({ ok: false, erro: "Conte o que aconteceu." }, 400);
  const db = getCatalogoDb();
  if (!db) return SEM_BANCO();
  try {
    const r = await gravarReporte(db, sessao, {
      texto,
      tela: str(corpo.tela),
      rota: str(corpo.rota),
      versao: corpo.versao === "anterior" ? "anterior" : "beta",
      motivo: null,
      printUrl: str(corpo.printUrl),
      tecnico: str(corpo.tecnico),
    });
    if ("erro" in r) return json({ ok: false, erro: "Você já enviou muitos reportes hoje. Tente amanhã." }, 429);
    return json({ ok: true, id: r.id });
  } catch (err) {
    console.warn("[betaReporteController] Falhou:", err);
    return json({ ok: false, erro: "Falha ao gravar." }, 500);
  }
}

export async function betaReportesController(request: Request): Promise<Response> {
  if (!(await requestProvesAdmin(request))) return SO_ADMIN();
  const db = getCatalogoDb();
  if (!db) return SEM_BANCO();
  const url = new URL(request.url);
  const st = url.searchParams.get("status") ?? "";
  const antes = url.searchParams.get("antesDe");
  const antesNum = antes !== null && antes !== "" ? Number(antes) : NaN;
  try {
    const reportes = await listarReportes(db, {
      status: STATUS_VALIDOS.includes(st) ? (st as StatusReporte) : undefined,
      limite: POR_PAGINA,
      antesDe: Number.isFinite(antesNum) ? antesNum : undefined,
    });
    return json({ ok: true, reportes });
  } catch (err) {
    console.warn("[betaReportesController] Falhou:", err);
    return json({ ok: false, erro: "Falha ao ler." }, 500);
  }
}

export async function betaReporteStatusController(request: Request): Promise<Response> {
  if (!(await requestProvesAdmin(request))) return SO_ADMIN();
  const corpo = await lerCorpo(request);
  const id = str(corpo?.id);
  const status = str(corpo?.status);
  if (!id || !STATUS_VALIDOS.includes(status)) return json({ ok: false, erro: "Pedido inválido." }, 400);
  const db = getCatalogoDb();
  if (!db) return SEM_BANCO();
  try {
    const ok = await mudarStatusReporte(db, id, status as StatusReporte);
    return ok ? json({ ok: true }) : json({ ok: false, erro: "Reporte não encontrado." }, 404);
  } catch (err) {
    console.warn("[betaReporteStatusController] Falhou:", err);
    return json({ ok: false, erro: "Falha ao gravar." }, 500);
  }
}

export async function betaConfigGetController(request: Request): Promise<Response> {
  if (!(await requestProvesAdmin(request))) return SO_ADMIN();
  return json({ ok: true, config: await lerConfig() });
}

export async function betaConfigPostController(request: Request): Promise<Response> {
  if (!(await requestProvesAdmin(request))) return SO_ADMIN();
  const kv = getKv();
  if (!kv?.put) return json({ ok: false, erro: "Armazenamento indisponível." }, 503);
  const corpo = await lerCorpo(request);
  const config = lerConfigBeta(corpo ? JSON.stringify(corpo) : null);
  try {
    await kv.put(KV_KEY, JSON.stringify(config));
    _zerarCacheConfigBeta();
    return json({ ok: true, config });
  } catch (err) {
    console.warn("[betaConfigPostController] Falhou:", err);
    return json({ ok: false, erro: "Falha ao gravar." }, 500);
  }
}

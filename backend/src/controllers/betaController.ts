// Beta test: estado/escolha de versão por jogador, reportes e chave do admin.
// Config no KV (`beta-config`); escolha e reportes no D1 (betaService).
import { verifySessionToken, extractBearerToken, requestProvesAdminOuFalha, ADMIN_TG_ID } from "../services/sessionService";
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

type WaitUntilCtx = { waitUntil: (promise: Promise<unknown>) => void };

const KV_KEY = "beta-config";
const MODOS_VALIDOS: readonly string[] = ["desligado", "convidados", "todos", "obrigatorio"];
// Print só do Drive (o upload do app devolve drive.google.com; lh3 é o proxy de imagem).
const HOSTS_PRINT: readonly string[] = ["drive.google.com", "lh3.googleusercontent.com"];
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

/** Config lida direto do KV (sem cache); erro ou sem KV → padrão. */
async function lerConfigDoKv(): Promise<ConfigBeta> {
  try {
    const kv = getKv();
    return kv ? lerConfigBeta(await kv.get(KV_KEY)) : { ...CONFIG_BETA_PADRAO, convidados: [] };
  } catch {
    return { ...CONFIG_BETA_PADRAO, convidados: [] };
  }
}

async function lerConfig(): Promise<ConfigBeta> {
  const agora = Date.now();
  if (cacheConfig && agora - cacheConfig.em < CACHE_CONFIG_MS) return cacheConfig.valor;
  const valor = await lerConfigDoKv();
  cacheConfig = { valor, em: agora };
  return valor;
}

function printDoDrive(url: string): string {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && HOSTS_PRINT.includes(u.hostname) ? url.slice(0, 500) : "";
  } catch {
    return "";
  }
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

/** Confirmação "é admin pela planilha" por id de sessão (por isolate), 10 min. */
const CACHE_ADMIN_MS = 10 * 60 * 1000;
const ESPERA_APOS_FALHA_MS = 60 * 1000;
const cacheAdmin = new Map<string, { admin: boolean; em: number }>();

/** Zera o cache de admin (testes). */
export function _zerarCacheAdminBeta(): void {
  cacheAdmin.clear();
}

/**
 * Admin = id antigo (ADMIN_TG_ID) ou "Tipo de Perfil = Admin" na planilha. O token não carrega o
 * tipo de perfil, então o app manda a dica `X-Empire-Admin: 1` e só então o servidor confirma na
 * planilha (cacheado 10 min). Sem a dica a planilha nunca é lida.
 */
async function ehAdmin(request: Request, sessao: { id: string }, exigeDica = true): Promise<boolean> {
  const id = sessao.id.trim();
  if (id === ADMIN_TG_ID) return true;
  if (exigeDica && request.headers.get("X-Empire-Admin") !== "1") return false;
  const agora = Date.now();
  const guardado = cacheAdmin.get(id);
  if (guardado && agora - guardado.em < CACHE_ADMIN_MS) return guardado.admin;
  try {
    const admin = await requestProvesAdminOuFalha(request);
    cacheAdmin.set(id, { admin, em: agora });
    return admin;
  } catch {
    // Leitura falhou (cota do Google, demora): não guarda "não é admin" por 10 min. Responde
    // não-admin agora e só tenta ler de novo daqui a 1 min, para não insistir na planilha.
    cacheAdmin.set(id, { admin: false, em: agora - CACHE_ADMIN_MS + ESPERA_APOS_FALHA_MS });
    return false;
  }
}

/** Telas só de admin (/beta-admin): mesma confirmação com cache, sem precisar da dica. */
async function soAdmin(request: Request): Promise<boolean> {
  const sessao = await verifySessionToken(extractBearerToken(request));
  return !!sessao && ehAdmin(request, sessao, false);
}

/** podeVer não depende da escolha: dá para saber sem ler o D1. */
async function podeVerBeta(request: Request, cfg: ConfigBeta, sessao: { id: string; usuario: string }): Promise<boolean> {
  return estadoBeta({ modo: cfg.modo, convidado: ehConvidado(cfg, sessao.id, sessao.usuario), admin: await ehAdmin(request, sessao), escolha: null }).podeVer;
}

async function estadoDe(request: Request, sessao: { id: string; usuario: string }, db: NonNullable<ReturnType<typeof getCatalogoDb>>) {
  const cfg = await lerConfig();
  const escolha = await lerEscolha(db, sessao.id);
  const est = estadoBeta({
    modo: cfg.modo,
    convidado: ehConvidado(cfg, sessao.id, sessao.usuario),
    admin: await ehAdmin(request, sessao),
    escolha: escolha.versao,
  });
  return { cfg, escolha, est };
}

const estadoSemBeta = (modo: ConfigBeta["modo"]) =>
  json({ ok: true, modo, podeVer: false, podeVoltar: false, versao: "anterior", boasVindasVistas: true });

export async function betaEstadoController(request: Request): Promise<Response> {
  const sessao = await verifySessionToken(extractBearerToken(request));
  if (!sessao?.id) return estadoSemBeta((await lerConfig()).modo);
  // Desligado e não admin: nada a ler no D1 (caso mais comum enquanto o Beta não abre).
  const cfgAntes = await lerConfig();
  if (cfgAntes.modo === "desligado" && !(await ehAdmin(request, sessao))) return estadoSemBeta(cfgAntes.modo);
  const db = getCatalogoDb();
  if (!db) return SEM_BANCO();
  try {
    await garantirTabelasBeta(db);
    const { cfg, escolha, est } = await estadoDe(request, sessao, db);
    return json({ ok: true, modo: cfg.modo, ...est, boasVindasVistas: escolha.boasVindasEm !== null });
  } catch (err) {
    console.warn("[betaEstadoController] Falhou:", err);
    return json({ ok: false, erro: "Falha ao ler." }, 500);
  }
}

/** Monta o reporte limpo (cortes e validações) e grava; avisa o admin sem esperar (ctx.waitUntil quando há). */
async function gravarReporte(
  db: NonNullable<ReturnType<typeof getCatalogoDb>>,
  sessao: { id: string; usuario: string },
  c: { texto: string; tela: string; rota: string; versao: Versao; motivo: MotivoVolta | null; printUrl: string; tecnico: string },
  ctx?: WaitUntilCtx,
): Promise<{ id: string } | { erro: "limite" }> {
  const printUrl = printDoDrive(c.printUrl);
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
    // Aviso ao admin: sem esperar e sem derrubar o reporte; o waitUntil segura o Worker até terminar.
    try {
      const tarefa = Promise.resolve(
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
      ).catch((err) => console.warn("[Beta] Erro ao avisar o admin:", err));
      if (ctx) ctx.waitUntil(tarefa);
      else void tarefa;
    } catch {
      /* ignora */
    }
  }
  return r;
}

export async function betaEscolhaController(request: Request, ctx?: WaitUntilCtx): Promise<Response> {
  const sessao = await verifySessionToken(extractBearerToken(request));
  if (!sessao?.id) return json({ ok: false, erro: "Entre na sua conta." }, 401);
  const corpo = await lerCorpo(request);
  const versao = corpo?.versao;
  if (!corpo || (versao !== "beta" && versao !== "anterior")) return json({ ok: false, erro: "Versão inválida." }, 400);
  const db = getCatalogoDb();
  if (!db) return SEM_BANCO();
  try {
    await garantirTabelasBeta(db);
    const { est } = await estadoDe(request, sessao, db);
    if (versao === "anterior" && !est.podeVoltar) return json({ ok: false, erro: "Não é possível voltar agora." }, 409);
    if (versao === "beta" && !est.podeVer) return json({ ok: false, erro: "O Beta não está liberado para você." }, 403);
    await gravarEscolha(db, sessao.id, versao, Date.now());
    const motivo = (MOTIVOS_VOLTA as readonly string[]).includes(str(corpo.motivo)) ? (str(corpo.motivo) as MotivoVolta) : null;
    const texto = str(corpo.texto).trim();
    if (motivo || texto) {
      // Reporte de quem trocou de versão: versao = a que estava usando antes da troca.
      // Try próprio: a escolha já está gravada, um erro aqui não vira 500.
      try {
        await gravarReporte(
          db,
          sessao,
          {
            texto: texto || (motivo ? ROTULO_MOTIVO[motivo] : ""),
            tela: str(corpo.tela),
            rota: str(corpo.rota),
            versao: versao === "anterior" ? "beta" : "anterior",
            motivo,
            printUrl: "",
            tecnico: "",
          },
          ctx,
        );
      } catch (err) {
        console.warn("[betaEscolhaController] Reporte da troca falhou:", err);
      }
    }
    return json({ ok: true, versao });
  } catch (err) {
    console.warn("[betaEscolhaController] Falhou:", err);
    return json({ ok: false, erro: "Falha ao gravar." }, 500);
  }
}

export async function betaReporteController(request: Request, ctx?: WaitUntilCtx): Promise<Response> {
  const sessao = await verifySessionToken(extractBearerToken(request));
  if (!sessao?.id) return json({ ok: false, erro: "Entre na sua conta." }, 401);
  const corpo = await lerCorpo(request);
  if (!corpo) return json({ ok: false, erro: "Pedido inválido." }, 400);
  const texto = str(corpo.texto).trim();
  if (!texto) return json({ ok: false, erro: "Conte o que aconteceu." }, 400);
  if (!(await podeVerBeta(request, await lerConfig(), sessao))) return json({ ok: false, erro: "O Beta test não está aberto para você." }, 403);
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
    }, ctx);
    if ("erro" in r) return json({ ok: false, erro: "Você já enviou muitos reportes hoje. Tente amanhã." }, 429);
    return json({ ok: true, id: r.id });
  } catch (err) {
    console.warn("[betaReporteController] Falhou:", err);
    return json({ ok: false, erro: "Falha ao gravar." }, 500);
  }
}

export async function betaReportesController(request: Request): Promise<Response> {
  if (!(await soAdmin(request))) return SO_ADMIN();
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
  if (!(await soAdmin(request))) return SO_ADMIN();
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
  if (!(await soAdmin(request))) return SO_ADMIN();
  // Direto do KV: o admin vê o que salvou, sem o cache de 60 s do estado.
  return json({ ok: true, config: await lerConfigDoKv() });
}

export async function betaConfigPostController(request: Request): Promise<Response> {
  if (!(await soAdmin(request))) return SO_ADMIN();
  const kv = getKv();
  if (!kv?.put) return json({ ok: false, erro: "Armazenamento indisponível." }, 503);
  const corpo = await lerCorpo(request);
  if (!corpo || typeof corpo.modo !== "string" || !MODOS_VALIDOS.includes(corpo.modo)) {
    return json({ ok: false, erro: "Configuração inválida." }, 400);
  }
  // Convidados inválidos são limpos por lerConfigBeta.
  const config = lerConfigBeta(JSON.stringify(corpo));
  try {
    await kv.put(KV_KEY, JSON.stringify(config));
    _zerarCacheConfigBeta();
    return json({ ok: true, config });
  } catch (err) {
    console.warn("[betaConfigPostController] Falhou:", err);
    return json({ ok: false, erro: "Falha ao gravar." }, 500);
  }
}

import { normalizeComparison } from "./googleSheetsService";
import {
  ADMIN_TG_ID,
  TOKEN_TTL_MS,
  extractBearerToken,
  verifySessionToken,
} from "./sessionService";

// Controle de acesso dos jogadores, comandado pelo admin na tela "Gestão de
// usuários":
//  - DESLOGAR: derruba todas as sessões abertas do jogador (tokens emitidos
//    antes do clique deixam de valer). Ele pode entrar de novo com a senha.
//  - BLOQUEAR: derruba as sessões E impede novo login até desbloquear.
//
// Tudo fica numa ÚNICA chave do KV FLAGS e é guardado em memória por 60s —
// nenhuma leitura da planilha, nenhuma checagem periódica. A conferência
// acontece só quando o app do jogador já está falando com o servidor (o app
// manda o token de sessão em toda chamada pra /api/ — ver __root.tsx); a
// resposta volta com o header X-Acesso-Revogado e o app desloga na hora.
const KV_KEY = "controle-acesso-usuarios";
const CACHE_MS = 60_000;

export interface RegistroAcesso {
  id: string;
  usuario: string;
  em: string; // ISO — quando o admin agiu
}

export interface ControleAcesso {
  bloqueados: RegistroAcesso[];
  logouts: RegistroAcesso[]; // último "Deslogar" de cada jogador
}

interface FlagsKvLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
}

function getFlags(): FlagsKvLike | undefined {
  return (globalThis as Record<string, unknown>).__FLAGS_KV__ as FlagsKvLike | undefined;
}

const VAZIO: ControleAcesso = { bloqueados: [], logouts: [] };
let cache: { at: number; dados: ControleAcesso } | null = null;

export async function lerControleAcesso(forcar = false): Promise<ControleAcesso> {
  if (!forcar && cache && Date.now() - cache.at < CACHE_MS) return cache.dados;
  const flags = getFlags();
  if (!flags) return VAZIO;
  try {
    const raw = await flags.get(KV_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<ControleAcesso>) : {};
    const dados: ControleAcesso = {
      bloqueados: Array.isArray(parsed.bloqueados) ? parsed.bloqueados : [],
      logouts: Array.isArray(parsed.logouts) ? parsed.logouts : [],
    };
    cache = { at: Date.now(), dados };
  } catch {
    cache = { at: Date.now(), dados: cache?.dados ?? VAZIO };
  }
  return cache.dados;
}

export async function salvarControleAcesso(dados: ControleAcesso): Promise<void> {
  const flags = getFlags();
  if (!flags) throw new Error("KV FLAGS indisponível neste ambiente.");
  await flags.put(KV_KEY, JSON.stringify(dados));
  cache = { at: Date.now(), dados };
}

export function mesmoJogador(
  r: { id?: string; usuario?: string },
  params: { id?: string; usuario?: string },
): boolean {
  const normId = normalizeComparison(params.id || "");
  const normUsuario = normalizeComparison(params.usuario || "");
  return (
    (!!normId && normalizeComparison(r.id || "") === normId) ||
    (!!normUsuario && normalizeComparison(r.usuario || "") === normUsuario)
  );
}

/** true se o jogador está bloqueado. O admin histórico nunca é bloqueado. */
export async function estaBloqueado(params: { id?: string; usuario?: string }): Promise<boolean> {
  if ((params.id || "").trim() === ADMIN_TG_ID) return false;
  if (!params.id && !params.usuario) return false;
  const { bloqueados } = await lerControleAcesso();
  return bloqueados.some((b) => mesmoJogador(b, params));
}

// Campos que identificam QUEM está agindo no corpo das requisições (só usado
// quando a chamada vem sem token, ex.: app antigo ainda aberto).
const CAMPOS_ATOR = ["tgId", "telegramId", "telegram_id", "userId", "user_id", "usuario"];

// Rotas que recebem o jogador ALVO no corpo (não o ator), ou o próprio login.
const ROTAS_ISENTAS = new Set([
  "/api/auth/login",
  "/api/auth/admin-impersonar",
  "/api/auth/admin/usuarios",
  "/api/auth/admin/acao",
]);

export const HEADER_ACESSO_REVOGADO = "X-Acesso-Revogado";

/**
 * Barreira global: se a chamada vem de um jogador bloqueado, ou de uma sessão
 * aberta ANTES do último "Deslogar" do admin, devolve 401 com o header
 * X-Acesso-Revogado (o app desloga ao ver isso). Devolve null quando pode
 * seguir. Só consulta o KV (com cache de 60s) — e nem isso quando ninguém
 * está bloqueado/deslogado.
 */
export async function barrarSeBloqueado(
  request: Request,
  pathname: string,
): Promise<Response | null> {
  if (request.method === "OPTIONS") return null;
  if (ROTAS_ISENTAS.has(pathname)) return null;

  const { bloqueados, logouts } = await lerControleAcesso();
  if (bloqueados.length === 0 && logouts.length === 0) return null;

  const payload = await verifySessionToken(extractBearerToken(request));
  if (payload) {
    if (payload.id.trim() === ADMIN_TG_ID) return null;
    const quem = { id: payload.id, usuario: payload.usuario };
    if (bloqueados.some((b) => mesmoJogador(b, quem))) return respostaRevogado();
    // Token guarda só a expiração; emissão = exp - validade.
    const emitidoEm = payload.exp - TOKEN_TTL_MS;
    const logout = logouts.find((l) => mesmoJogador(l, quem));
    if (logout && emitidoEm < Date.parse(logout.em)) return respostaRevogado();
    return null;
  }

  // Sem token: só dá pra identificar pelo corpo (escritas). O heartbeat sem
  // token de quem foi deslogado também é barrado — senão ele ganharia um
  // token novo e escaparia do "Deslogar".
  if (request.method === "GET" || request.method === "HEAD") return null;
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) return null;
  let body: unknown;
  try {
    body = await request.clone().json();
  } catch {
    return null;
  }
  if (!body || typeof body !== "object") return null;
  const rec = body as Record<string, unknown>;
  for (const campo of CAMPOS_ATOR) {
    const v = rec[campo];
    if (typeof v !== "string" && typeof v !== "number") continue;
    const valor = String(v);
    if (valor === ADMIN_TG_ID) continue;
    const quem = { id: valor, usuario: valor };
    if (bloqueados.some((b) => mesmoJogador(b, quem))) return respostaRevogado();
    if (pathname === "/api/auth/heartbeat" && logouts.some((l) => mesmoJogador(l, quem))) {
      return respostaRevogado();
    }
  }
  return null;
}

export function respostaRevogado(status = 401): Response {
  return new Response(
    JSON.stringify({
      success: false,
      acessoRevogado: true,
      error: "Sua sessão foi encerrada por um admin.",
    }),
    { status, headers: { "Content-Type": "application/json", [HEADER_ACESSO_REVOGADO]: "1" } },
  );
}

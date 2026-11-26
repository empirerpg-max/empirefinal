import { normalizeComparison } from "./googleSheetsService";
import { ADMIN_TG_ID, extractBearerToken, verifySessionToken } from "./sessionService";

// Lista de jogadores com acesso REMOVIDO pelo admin ("Remover acesso" no
// Perfil). Fica no KV FLAGS (mesmo binding já usado pela TV/error-log), numa
// chave só, como array JSON. Não apaga nada da planilha — só impede login,
// derruba a sessão salva no navegador (heartbeat responde "revogado" e o app
// volta pra tela de login) e recusa qualquer escrita (POST/PUT/PATCH/DELETE)
// feita em nome desse jogador.
const KV_KEY = "usuarios-bloqueados";
const CACHE_MS = 30_000;

export interface UsuarioBloqueado {
  id: string;
  usuario: string;
  em: string; // ISO
  por?: string;
}

interface FlagsKvLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
}

function getFlags(): FlagsKvLike | undefined {
  return (globalThis as Record<string, unknown>).__FLAGS_KV__ as FlagsKvLike | undefined;
}

let cache: { at: number; lista: UsuarioBloqueado[] } | null = null;

export async function listarBloqueados(forcar = false): Promise<UsuarioBloqueado[]> {
  if (!forcar && cache && Date.now() - cache.at < CACHE_MS) return cache.lista;
  const flags = getFlags();
  if (!flags) return [];
  try {
    const raw = await flags.get(KV_KEY);
    const lista = raw ? (JSON.parse(raw) as UsuarioBloqueado[]) : [];
    cache = { at: Date.now(), lista: Array.isArray(lista) ? lista : [] };
  } catch {
    cache = { at: Date.now(), lista: cache?.lista ?? [] };
  }
  return cache.lista;
}

export async function salvarBloqueados(lista: UsuarioBloqueado[]): Promise<void> {
  const flags = getFlags();
  if (!flags) throw new Error("KV FLAGS indisponível neste ambiente.");
  await flags.put(KV_KEY, JSON.stringify(lista));
  cache = { at: Date.now(), lista };
}

/** true se id OU usuário bate com alguém da lista de bloqueio. O admin histórico nunca é bloqueado. */
export async function estaBloqueado(params: { id?: string; usuario?: string }): Promise<boolean> {
  const normId = normalizeComparison(params.id || "");
  const normUsuario = normalizeComparison(params.usuario || "");
  if (!normId && !normUsuario) return false;
  if ((params.id || "").trim() === ADMIN_TG_ID) return false;
  const lista = await listarBloqueados();
  return lista.some(
    (b) =>
      (!!normId && normalizeComparison(b.id || "") === normId) ||
      (!!normUsuario && normalizeComparison(b.usuario || "") === normUsuario),
  );
}

// Campos que identificam QUEM está agindo no corpo das requisições do app.
const CAMPOS_ATOR = ["tgId", "telegramId", "telegram_id", "userId", "user_id", "usuario"];

// Rotas de admin que recebem o usuário ALVO no corpo (não o ator) — nunca
// barrar aqui, senão o admin não consegue simular/restaurar um bloqueado.
const ROTAS_ISENTAS = new Set([
  "/api/auth/admin-impersonar",
  "/api/auth/admin/bloquear",
  "/api/auth/admin/desbloquear",
  "/api/auth/admin/bloqueados",
  "/api/auth/login",
]);

export const HEADER_ACESSO_REVOGADO = "X-Acesso-Revogado";

/**
 * Barreira global de escrita: se a requisição (não-GET) vem de um jogador
 * bloqueado — pelo token de sessão ou, sem token, pelo id/usuário no corpo —
 * devolve 403 com o header X-Acesso-Revogado (o front usa isso pra forçar o
 * logout na hora). Devolve null quando pode seguir.
 */
export async function barrarSeBloqueado(
  request: Request,
  pathname: string,
): Promise<Response | null> {
  if (request.method === "GET" || request.method === "HEAD" || request.method === "OPTIONS")
    return null;
  if (ROTAS_ISENTAS.has(pathname)) return null;

  const lista = await listarBloqueados();
  if (lista.length === 0) return null;

  const payload = await verifySessionToken(extractBearerToken(request));
  if (payload) {
    // Token válido identifica o ator com certeza — decide só por ele.
    return (await estaBloqueado({ id: payload.id, usuario: payload.usuario }))
      ? respostaRevogado()
      : null;
  }

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
    if (await estaBloqueado({ id: valor, usuario: valor })) return respostaRevogado();
  }
  return null;
}

export function respostaRevogado(status = 403): Response {
  return new Response(
    JSON.stringify({
      success: false,
      acessoRevogado: true,
      error: "Seu acesso ao Empire Hub foi removido por um admin.",
    }),
    { status, headers: { "Content-Type": "application/json", [HEADER_ACESSO_REVOGADO]: "1" } },
  );
}

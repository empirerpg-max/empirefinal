import { readRuntimeEnv } from "../google/service-account";

// Token de sessão assinado (HMAC-SHA256), gerado no login/heartbeat e
// verificado nas ações administrativas sensíveis (ex: bypass de admin em
// posts/comentários/playlists). Não é JWT — formato simples
// `payload_base64url.assinatura_base64url` — o suficiente pra provar que o
// cliente que envia um `tgId`/`usuario` é quem de fato autenticou como tal,
// sem precisar de biblioteca externa nem de storage (fica tudo verificável
// na hora, sem KV/D1). Nunca interfere na edição direta da planilha — é só
// autenticação HTTP entre front e back.
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias — app casual, sem re-login chato

// ID de admin histórico, hardcoded em vários controllers — centralizado
// aqui só pra facilitar comparação junto da verificação de token.
export const ADMIN_TG_ID = "810141686";

export interface SessionPayload {
  usuario: string;
  id: string;
  exp: number; // epoch ms
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(str: string): Uint8Array<ArrayBuffer> {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(str.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// Sem SESSION_TOKEN_SECRET configurado (ex: dev local sem secrets), cai num
// valor fixo — tokens continuam funcionando dentro do próprio ambiente, só
// não são portáveis/seguros entre ambientes diferentes com o mesmo fallback.
function getSecret(): string {
  return readRuntimeEnv("SESSION_TOKEN_SECRET") || "empire-hub-dev-session-secret-fallback";
}

async function getHmacKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(getSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function issueSessionToken(usuario: string, id: string): Promise<string> {
  const payload: SessionPayload = { usuario, id, exp: Date.now() + TOKEN_TTL_MS };
  const payloadB64 = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await getHmacKey();
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payloadB64));
  const sigB64 = base64UrlEncode(new Uint8Array(signature));
  return `${payloadB64}.${sigB64}`;
}

export async function verifySessionToken(token: string | null | undefined): Promise<SessionPayload | null> {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, sigB64] = parts;

  let signatureBytes: Uint8Array<ArrayBuffer>;
  try {
    signatureBytes = base64UrlDecode(sigB64);
  } catch {
    return null;
  }

  const key = await getHmacKey();
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    signatureBytes,
    new TextEncoder().encode(payloadB64),
  );
  if (!valid) return null;

  try {
    const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(payloadB64))) as SessionPayload;
    if (!payload || typeof payload.exp !== "number" || payload.exp < Date.now()) return null;
    if (typeof payload.usuario !== "string" || typeof payload.id !== "string") return null;
    return payload;
  } catch {
    return null;
  }
}

export function extractBearerToken(request: Request): string | null {
  const header = request.headers.get("authorization") || request.headers.get("Authorization");
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

/**
 * Confere se a requisição carrega um token de sessão válido cujo `id`
 * bate com o admin hardcoded (ADMIN_TG_ID). Usado nos pontos que antes só
 * confiavam num `tgId`/`telegramId` de corpo de requisição pra liberar
 * ações de admin — agora isso só passa se o cliente de fato autenticou como
 * esse usuário no login.
 */
export async function requestProvesAdmin(request: Request): Promise<boolean> {
  const token = extractBearerToken(request);
  const payload = await verifySessionToken(token);
  return !!payload && payload.id.trim() === ADMIN_TG_ID;
}

import { readRuntimeEnv } from "../google/service-account";
import { googleSheetsService, normalizeComparison } from "./googleSheetsService";

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
 * Confere se a requisição carrega um token de sessão válido cujo dono é
 * admin de verdade. Usado nos pontos que antes só confiavam num
 * `tgId`/`telegramId` de corpo de requisição pra liberar ações de admin —
 * agora isso só passa se o cliente de fato autenticou como esse usuário no
 * login.
 *
 * BUG REAL confirmado (2026-10-23, admin "Hugo" — tipo_de_perfil=Admin na
 * planilha, visível no próprio perfil dele com o badge "ADMIN" — levando
 * "Acesso restrito ao admin." ao tentar usar "Entrar como usuário"): esta
 * função só reconhecia UM id hardcoded (ADMIN_TG_ID, histórico, de outra
 * pessoa) como admin de verdade, ignorando completamente qualquer usuário
 * marcado como Admin na planilha (coluna "Tipo de Perfil") — a mesma
 * condição que o FRONTEND já usa pra decidir se mostra os controles de
 * admin (ver `isAdminUser` em Gestao.tsx/perfil.tsx: `id === ADMIN_TG_ID
 * || tipoPerfil === "Admin"`), mas o backend só reconhecia metade dela.
 * Resultado: qualquer admin "de planilha" via os controles normalmente,
 * clicava, e sempre batia num 403 sem explicação nenhuma. Agora confere a
 * mesma condição dos dois lados: ID hardcoded OU tipo_de_perfil=Admin na
 * aba Usuários.
 */
export async function requestProvesAdmin(request: Request): Promise<boolean> {
  const token = extractBearerToken(request);
  const payload = await verifySessionToken(token);
  if (!payload) return false;
  if (payload.id.trim() === ADMIN_TG_ID) return true;

  const rows = await googleSheetsService.usuarios.readValues("Usuários").catch(() => []);
  if (rows.length < 2) return false;
  const header = rows[0];
  const idxId = header.findIndex((h) => normalizeComparison(h) === normalizeComparison("ID"));
  const idxUsuario = header.findIndex((h) => normalizeComparison(h) === normalizeComparison("Usuário"));
  const idxTipoPerfil = header.findIndex(
    (h) => normalizeComparison(h) === normalizeComparison("Tipo de Perfil"),
  );
  if (idxTipoPerfil === -1) return false;

  const normId = normalizeComparison(payload.id);
  const normUsuario = normalizeComparison(payload.usuario);
  const match = rows.slice(1).find((row) => {
    const matchId = idxId >= 0 && !!normId && normalizeComparison(row[idxId] || "") === normId;
    const matchUsuario =
      idxUsuario >= 0 && !!normUsuario && normalizeComparison(row[idxUsuario] || "") === normUsuario;
    return matchId || matchUsuario;
  });
  return !!match && normalizeComparison(match[idxTipoPerfil] || "") === normalizeComparison("Admin");
}

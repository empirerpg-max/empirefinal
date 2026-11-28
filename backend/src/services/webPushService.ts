// Web Push (notificação no celular/navegador mesmo com o app fechado).
//
// Implementação "na mão" com WebCrypto — as libs prontas (web-push) dependem
// de módulos do Node (crypto/https) que não rodam bem no Worker. O protocolo
// é pequeno e padronizado:
//   - RFC 8292 (VAPID): JWT ES256 assinado com a chave privada do servidor,
//     mandado no header Authorization pra provar ao serviço de push (FCM,
//     Mozilla, Apple) que a mensagem veio deste app.
//   - RFC 8291 + RFC 8188 (aes128gcm): o conteúdo é criptografado com uma
//     chave derivada por ECDH entre uma chave efêmera nossa e a chave pública
//     da inscrição (p256dh), mais o segredo "auth" da inscrição.
//
// Inscrições e preferências ficam no KV FLAGS (exposto em globalThis por
// injectRuntimeEnv, src/server.ts):
//   push:subs:<tgId>  -> PushSubscriptionJson[] (um por aparelho/navegador)
//   notif:prefs:<tgId> -> NotifPrefs
//
// Chaves VAPID: se os secrets VAPID_PUBLIC_KEY (ponto público P-256 sem
// compressão, base64url, 65 bytes) e VAPID_PRIVATE_KEY (escalar "d",
// base64url) existirem, usa eles. Senão, o próprio Worker gera um par na
// primeira vez e guarda no D1 (tabela config_app) — nenhum passo manual de
// deploy. D1 (e não KV) porque é consistente na hora: com KV, dois isolates
// podiam gerar pares diferentes ao mesmo tempo e metade das inscrições
// ficaria presa a uma chave que o servidor não usa mais. INSERT OR IGNORE +
// releitura garante que todo mundo acaba com o MESMO par.
// VAPID_SUBJECT é opcional (mailto: ou https: de contato).

import { readRuntimeEnv } from "../google/service-account";
import { getCatalogoDb } from "./catalogoDbService";

export interface PushSubscriptionJson {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export type TipoNotificacao = "comentario_forum" | "curtida_social" | "comentario_social";

export const TIPOS_NOTIFICACAO: TipoNotificacao[] = [
  "comentario_forum",
  "curtida_social",
  "comentario_social",
];

export type NotifPrefs = Record<TipoNotificacao, boolean>;

export const DEFAULT_PREFS: NotifPrefs = {
  comentario_forum: true,
  curtida_social: true,
  comentario_social: true,
};

interface KvLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

function getKv(): KvLike | undefined {
  return (globalThis as Record<string, unknown>).__FLAGS_KV__ as KvLike | undefined;
}

const MAX_SUBS_POR_USUARIO = 10;

// -------------------- base64url --------------------

function b64urlToBytes(s: string): Bytes {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const b64 = (s + pad).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64url(bytes: Bytes): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function concat(...parts: Bytes[]): Bytes {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

const enc = new TextEncoder();

type Bytes = Uint8Array<ArrayBuffer>;

// -------------------- KV: inscrições e preferências --------------------

interface VapidKeys {
  pub: string;
  d: string;
}

let vapidKeysCache: VapidKeys | null = null;

async function gerarParVapid(): Promise<VapidKeys> {
  const kp = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const raw = new Uint8Array((await crypto.subtle.exportKey("raw", kp.publicKey)) as ArrayBuffer);
  const jwk = (await crypto.subtle.exportKey("jwk", kp.privateKey)) as JsonWebKey;
  return { pub: bytesToB64url(raw), d: String(jwk.d) };
}

async function getVapidKeys(): Promise<VapidKeys | null> {
  if (vapidKeysCache) return vapidKeysCache;
  const envPub = readRuntimeEnv("VAPID_PUBLIC_KEY").trim();
  const envPriv = readRuntimeEnv("VAPID_PRIVATE_KEY").trim();
  if (envPub && envPriv) {
    vapidKeysCache = { pub: envPub, d: envPriv };
    return vapidKeysCache;
  }
  const db = getCatalogoDb();
  if (!db) return null;
  try {
    await db
      .prepare("CREATE TABLE IF NOT EXISTS config_app (chave TEXT PRIMARY KEY, valor TEXT NOT NULL)")
      .run();
    const lerChave = async () =>
      (
        await db
          .prepare("SELECT valor FROM config_app WHERE chave = ?")
          .bind("vapid_keys")
          .all<{ valor: string }>()
      ).results[0]?.valor;
    let valor = await lerChave();
    if (!valor) {
      const novo = await gerarParVapid();
      await db
        .prepare("INSERT OR IGNORE INTO config_app (chave, valor) VALUES (?, ?)")
        .bind("vapid_keys", JSON.stringify(novo))
        .run();
      valor = await lerChave();
    }
    const parsed = valor ? (JSON.parse(valor) as VapidKeys) : null;
    if (!parsed?.pub || !parsed?.d) return null;
    vapidKeysCache = parsed;
    return parsed;
  } catch (err) {
    console.warn("[webPush] Falha ao obter/gerar chaves VAPID no D1:", err);
    return null;
  }
}

export async function getVapidPublicKey(): Promise<string> {
  return (await getVapidKeys())?.pub || "";
}

export async function pushConfigurado(): Promise<boolean> {
  return !!getKv() && !!(await getVapidKeys());
}

async function lerSubs(tgId: string): Promise<PushSubscriptionJson[]> {
  const kv = getKv();
  if (!kv) return [];
  try {
    const raw = await kv.get(`push:subs:${tgId}`);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((s) => s?.endpoint && s?.keys?.p256dh && s?.keys?.auth) : [];
  } catch {
    return [];
  }
}

async function gravarSubs(tgId: string, subs: PushSubscriptionJson[]): Promise<void> {
  const kv = getKv();
  if (!kv) return;
  if (subs.length === 0) await kv.delete(`push:subs:${tgId}`);
  else await kv.put(`push:subs:${tgId}`, JSON.stringify(subs));
}

export async function adicionarInscricao(tgId: string, sub: PushSubscriptionJson): Promise<void> {
  const subs = (await lerSubs(tgId)).filter((s) => s.endpoint !== sub.endpoint);
  subs.push({ endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } });
  await gravarSubs(tgId, subs.slice(-MAX_SUBS_POR_USUARIO));
}

export async function removerInscricao(tgId: string, endpoint: string): Promise<void> {
  const subs = await lerSubs(tgId);
  await gravarSubs(
    tgId,
    subs.filter((s) => s.endpoint !== endpoint),
  );
}

export async function temInscricao(tgId: string, endpoint?: string): Promise<boolean> {
  const subs = await lerSubs(tgId);
  return endpoint ? subs.some((s) => s.endpoint === endpoint) : subs.length > 0;
}

export async function lerPreferencias(tgId: string): Promise<NotifPrefs> {
  const kv = getKv();
  if (!kv) return { ...DEFAULT_PREFS };
  try {
    const raw = await kv.get(`notif:prefs:${tgId}`);
    const parsed = raw ? (JSON.parse(raw) as Partial<NotifPrefs>) : {};
    const out = { ...DEFAULT_PREFS };
    for (const t of TIPOS_NOTIFICACAO) if (typeof parsed[t] === "boolean") out[t] = parsed[t] as boolean;
    return out;
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export async function gravarPreferencias(tgId: string, prefs: Partial<NotifPrefs>): Promise<NotifPrefs> {
  const atual = await lerPreferencias(tgId);
  for (const t of TIPOS_NOTIFICACAO) if (typeof prefs[t] === "boolean") atual[t] = prefs[t] as boolean;
  const kv = getKv();
  if (kv) await kv.put(`notif:prefs:${tgId}`, JSON.stringify(atual));
  return atual;
}

// -------------------- VAPID (RFC 8292) --------------------

let vapidKeyCache: { pub: string; key: CryptoKey } | null = null;

async function getVapidSigningKey(): Promise<CryptoKey> {
  const keys = await getVapidKeys();
  if (!keys) throw new Error("Chaves VAPID indisponíveis");
  const pub = keys.pub;
  if (vapidKeyCache && vapidKeyCache.pub === pub) return vapidKeyCache.key;
  const pubBytes = b64urlToBytes(pub);
  if (pubBytes.length !== 65 || pubBytes[0] !== 4) throw new Error("VAPID_PUBLIC_KEY inválida");
  const key = await crypto.subtle.importKey(
    "jwk",
    {
      kty: "EC",
      crv: "P-256",
      x: bytesToB64url(pubBytes.slice(1, 33)),
      y: bytesToB64url(pubBytes.slice(33, 65)),
      d: keys.d,
      ext: true,
    },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  vapidKeyCache = { pub, key };
  return key;
}

async function vapidAuthHeader(endpoint: string): Promise<string> {
  const aud = new URL(endpoint).origin;
  const sub = readRuntimeEnv("VAPID_SUBJECT").trim() || "mailto:suporte@empirehub.app";
  const header = bytesToB64url(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = bytesToB64url(
    enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub })),
  );
  const unsigned = `${header}.${claims}`;
  const key = await getVapidSigningKey();
  // WebCrypto já devolve a assinatura ECDSA no formato JOSE (r||s, 64 bytes).
  const sig = new Uint8Array(
    await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(unsigned)),
  );
  return `vapid t=${unsigned}.${bytesToB64url(sig)}, k=${await getVapidPublicKey()}`;
}

// -------------------- Criptografia do conteúdo (RFC 8291) --------------------

async function hkdf(salt: Bytes, ikm: Bytes, info: Bytes, bytes: number): Promise<Bytes> {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, bytes * 8);
  return new Uint8Array(bits);
}

async function encryptPayload(sub: PushSubscriptionJson, plaintext: Bytes): Promise<Bytes> {
  const uaPublic = b64urlToBytes(sub.keys.p256dh);
  const authSecret = b64urlToBytes(sub.keys.auth);

  const asKeys = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ])) as CryptoKeyPair;
  const asPublic = new Uint8Array((await crypto.subtle.exportKey("raw", asKeys.publicKey)) as ArrayBuffer);
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey } as any, asKeys.privateKey, 256),
  );

  const keyInfo = concat(enc.encode("WebPush: info\0"), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);

  // Registro único: conteúdo + delimitador 0x02 (último registro, sem padding extra).
  const record = concat(plaintext, new Uint8Array([2]));
  const aesKey = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, record));

  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096);
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, cipher);
}

// -------------------- Envio --------------------

export interface PushPayload {
  title: string;
  body: string;
  url: string;
  tag?: string;
}

/** Envia pra uma inscrição. Devolve "gone" quando o aparelho desinscreveu (404/410). */
async function enviarParaInscricao(sub: PushSubscriptionJson, payload: PushPayload): Promise<"ok" | "gone" | "erro"> {
  try {
    const body = await encryptPayload(sub, enc.encode(JSON.stringify(payload)));
    const res = await fetch(sub.endpoint, {
      method: "POST",
      headers: {
        Authorization: await vapidAuthHeader(sub.endpoint),
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        TTL: String(24 * 3600),
        Urgency: "normal",
      },
      body,
    });
    if (res.status === 404 || res.status === 410) return "gone";
    if (!res.ok) {
      console.warn(`[webPush] Serviço de push respondeu ${res.status}:`, await res.text().catch(() => ""));
      return "erro";
    }
    return "ok";
  } catch (err) {
    console.warn("[webPush] Falha ao enviar push:", err);
    return "erro";
  }
}

/**
 * Manda a notificação pra todos os aparelhos inscritos do jogador, se ele
 * tiver esse tipo ligado nas preferências. Nunca lança — push é "bônus" em
 * cima da notificação do sininho, que já foi gravada antes.
 */
export async function enviarPushParaUsuario(
  tgId: string,
  tipo: TipoNotificacao,
  payload: PushPayload,
): Promise<void> {
  try {
    const id = (tgId || "").trim();
    if (!id || !(await pushConfigurado())) return;
    const prefs = await lerPreferencias(id);
    if (!prefs[tipo]) return;
    const subs = await lerSubs(id);
    if (subs.length === 0) return;

    const resultados = await Promise.all(subs.map((s) => enviarParaInscricao(s, payload)));
    const mortas = new Set(subs.filter((_, i) => resultados[i] === "gone").map((s) => s.endpoint));
    if (mortas.size > 0) {
      await gravarSubs(
        id,
        subs.filter((s) => !mortas.has(s.endpoint)),
      );
    }
  } catch (err) {
    console.warn("[webPush] Erro inesperado ao enviar push:", err);
  }
}

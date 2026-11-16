// Gera o par de chaves VAPID usado pelas notificações no celular (Web Push).
// Rode uma vez e cadastre os valores como secrets do Worker:
//
//   node scripts/gerar-chaves-vapid.mjs
//   npx wrangler secret put VAPID_PUBLIC_KEY   (cola a pública)
//   npx wrangler secret put VAPID_PRIVATE_KEY  (cola a privada)
//
// Opcional: VAPID_SUBJECT = "mailto:seu-contato@exemplo.com".
// Trocar as chaves depois invalida as inscrições já feitas (cada jogador
// precisa ativar de novo no aparelho) — gere uma vez só.
import { webcrypto as crypto } from "node:crypto";

const { publicKey, privateKey } = await crypto.subtle.generateKey(
  { name: "ECDSA", namedCurve: "P-256" },
  true,
  ["sign", "verify"],
);
const raw = new Uint8Array(await crypto.subtle.exportKey("raw", publicKey));
const jwk = await crypto.subtle.exportKey("jwk", privateKey);
const b64url = (bytes) => Buffer.from(bytes).toString("base64url");

console.log("VAPID_PUBLIC_KEY =", b64url(raw));
console.log("VAPID_PRIVATE_KEY =", jwk.d);

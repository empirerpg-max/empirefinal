export interface GoogleServiceAccountCredentials {
  clientEmail: string;
  privateKey: string;
  tokenUri: string;
  projectId?: string;
  privateKeyId?: string;
}

interface GoogleTokenCacheEntry {
  accessToken: string;
  expiresAt: number;
}

const GOOGLE_TOKEN_CACHE = new Map<string, GoogleTokenCacheEntry>();
const ONE_MINUTE_MS = 60_000;

export function readRuntimeEnv(name: string): string {
  const processValue =
    typeof process !== "undefined" && process.env ? process.env[name] : undefined;

  if (typeof processValue === "string" && processValue.trim()) {
    return processValue;
  }

  const globalValue = (globalThis as Record<string, unknown>)[`__${name}__`];
  return typeof globalValue === "string" ? globalValue : "";
}

function normalizePrivateKey(privateKey: string): string {
  return privateKey.replace(/\\n/g, "\n").trim();
}

function decodeBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const normalized = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");

  const bytes = decodeBase64(normalized);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function base64UrlEncode(input: string | Uint8Array): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;

  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function resolveServiceAccount(): GoogleServiceAccountCredentials {
  const rawJson =
    readRuntimeEnv("GOOGLE_SHEETS_CREDENTIALS") || readRuntimeEnv("GOOGLE_SERVICE_ACCOUNT_JSON");
  if (rawJson) {
    const parsed = JSON.parse(rawJson) as {
      client_email?: string;
      private_key?: string;
      token_uri?: string;
      project_id?: string;
      private_key_id?: string;
    };

    if (!parsed.client_email || !parsed.private_key) {
      throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON não contém client_email/private_key.");
    }

    return {
      clientEmail: parsed.client_email,
      privateKey: normalizePrivateKey(parsed.private_key),
      tokenUri: parsed.token_uri || "https://oauth2.googleapis.com/token",
      projectId: parsed.project_id,
      privateKeyId: parsed.private_key_id,
    };
  }

  const clientEmail = readRuntimeEnv("GOOGLE_SERVICE_ACCOUNT_CLIENT_EMAIL");
  const privateKey = normalizePrivateKey(readRuntimeEnv("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY"));
  const tokenUri =
    readRuntimeEnv("GOOGLE_SERVICE_ACCOUNT_TOKEN_URI") || "https://oauth2.googleapis.com/token";

  if (!clientEmail || !privateKey) {
    throw new Error(
      "Credenciais Google Sheets ausentes. Configure GOOGLE_SERVICE_ACCOUNT_JSON ou GOOGLE_SERVICE_ACCOUNT_CLIENT_EMAIL/GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY.",
    );
  }

  return {
    clientEmail,
    privateKey,
    tokenUri,
    projectId: readRuntimeEnv("GOOGLE_SERVICE_ACCOUNT_PROJECT_ID") || undefined,
    privateKeyId: readRuntimeEnv("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY_ID") || undefined,
  };
}

async function importPrivateKey(privateKey: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(privateKey),
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: "SHA-256",
    },
    false,
    ["sign"],
  );
}

async function createSignedJwt(
  credentials: GoogleServiceAccountCredentials,
  scopes: string[],
): Promise<string> {
  const nowInSeconds = Math.floor(Date.now() / 1000);
  const header = {
    alg: "RS256",
    typ: "JWT",
    kid: credentials.privateKeyId,
  };
  const payload = {
    iss: credentials.clientEmail,
    scope: scopes.join(" "),
    aud: credentials.tokenUri,
    exp: nowInSeconds + 3600,
    iat: nowInSeconds,
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const unsignedToken = `${encodedHeader}.${encodedPayload}`;
  const key = await importPrivateKey(credentials.privateKey);
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsignedToken),
  );

  return `${unsignedToken}.${base64UrlEncode(new Uint8Array(signature))}`;
}

export async function getGoogleAccessToken(scopes: string[]): Promise<string> {
  const cacheKey = [...scopes].sort().join(" ");
  const cached = GOOGLE_TOKEN_CACHE.get(cacheKey);

  if (cached && cached.expiresAt > Date.now() + ONE_MINUTE_MS) {
    return cached.accessToken;
  }

  const credentials = resolveServiceAccount();
  const assertion = await createSignedJwt(credentials, scopes);
  const response = await fetch(credentials.tokenUri, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }).toString(),
  });

  const body = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
    token_type?: string;
    error?: string;
    error_description?: string;
  };

  if (!response.ok || !body.access_token) {
    throw new Error(
      `Falha ao obter token Google: ${body.error || response.status} ${body.error_description || ""}`.trim(),
    );
  }

  const expiresInMs = (body.expires_in ?? 3600) * 1000;
  GOOGLE_TOKEN_CACHE.set(cacheKey, {
    accessToken: body.access_token,
    expiresAt: Date.now() + expiresInMs,
  });

  return body.access_token;
}

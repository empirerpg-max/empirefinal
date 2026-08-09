import "./lib/error-capture";

import { handleEmpireApiRoutes } from "../backend/src";
import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

// ─────────────────────────────────────────────────────────────────────────────
// Tabelas suportadas por /api/catalogo?action=<action>
// ─────────────────────────────────────────────────────────────────────────────
const ACTION_TABLE: Record<string, string> = {
  albuns: "Albuns",
  musicas: "Musicas",
  videos: "Videos",
  music_videos: "Music Videos",
};

// ─────────────────────────────────────────────────────────────────────────────
// Proxy de vídeos grandes do Telegram (serviço separado em telegram-media/,
// que fala MTProto). O token de admin do serviço nunca chega ao navegador —
// só este Worker o conhece, via secret.
// ─────────────────────────────────────────────────────────────────────────────
async function handleTelegramVideoProxy(
  request: Request,
  env: { TELEGRAM_MEDIA_SERVICE_URL?: string; TELEGRAM_MEDIA_ADMIN_TOKEN?: string },
  messageId: string,
): Promise<Response> {
  if (!env.TELEGRAM_MEDIA_SERVICE_URL || !env.TELEGRAM_MEDIA_ADMIN_TOKEN) {
    return new Response("Serviço de vídeo do Telegram não configurado.", { status: 503 });
  }
  const upstreamUrl = `${env.TELEGRAM_MEDIA_SERVICE_URL.replace(/\/$/, "")}/video/${encodeURIComponent(messageId)}`;
  const headers = new Headers({ "x-admin-token": env.TELEGRAM_MEDIA_ADMIN_TOKEN });
  const range = request.headers.get("range");
  if (range) headers.set("range", range);

  const upstream = await fetch(upstreamUrl, { headers });
  const responseHeaders = new Headers(upstream.headers);
  responseHeaders.delete("x-admin-token");
  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
}

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const RUNTIME_ENV_KEYS = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "GOOGLE_SERVICE_ACCOUNT_JSON",
  "GOOGLE_SHEETS_CREDENTIALS",
  "GOOGLE_SERVICE_ACCOUNT_CLIENT_EMAIL",
  "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY",
  "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY_ID",
  "GOOGLE_SERVICE_ACCOUNT_PROJECT_ID",
  "GOOGLE_SERVICE_ACCOUNT_TOKEN_URI",
  "GH_DISPATCH_TOKEN",
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// Handler de /api/catalogo — consulta Supabase REST diretamente
// ─────────────────────────────────────────────────────────────────────────────
async function handleCatalogoApi(request: Request): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const action = url.searchParams.get("action") ?? "";
  const table = ACTION_TABLE[action];

  if (!table) {
    return new Response(
      JSON.stringify({
        error: `Ação desconhecida: "${action}". Use: ${Object.keys(ACTION_TABLE).join(", ")}.`,
      }),
      { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
    );
  }

  // Lê credenciais do ambiente (Cloudflare Workers env ou Node process.env)
  // Em Cloudflare Workers as variáveis chegam pelo objeto `env`; como
  // o handler foi desenhado para receber apenas `request`, lemos de
  // process.env que o bundler injeta via define() no vite.config.
  const supabaseUrl =
    (typeof process !== "undefined" && process.env?.SUPABASE_URL) ||
    (globalThis as any).__SUPABASE_URL__ ||
    "";
  const serviceKey =
    (typeof process !== "undefined" && process.env?.SUPABASE_SERVICE_ROLE_KEY) ||
    (globalThis as any).__SUPABASE_SERVICE_ROLE_KEY__ ||
    "";

  if (!supabaseUrl || !serviceKey) {
    console.error(
      "[api/catalogo] Variáveis SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY não configuradas.",
    );
    return new Response(
      JSON.stringify({ error: "Configuração do servidor incompleta. Contate o administrador." }),
      { status: 503, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
    );
  }

  // Monta a URL da REST API do Supabase
  // Tabelas com espaço precisam ser codificadas: "Music Videos" → "Music%20Videos"
  const encodedTable = encodeURIComponent(table);
  const restUrl = `${supabaseUrl}/rest/v1/${encodedTable}?select=*`;

  try {
    console.log(`[api/catalogo] Buscando tabela "${table}" em:`, restUrl);

    const res = await fetch(restUrl, {
      method: "GET",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
    });

    const body = await res.text();

    if (!res.ok) {
      console.error(`[api/catalogo] Supabase retornou HTTP ${res.status}:`, body);
      return new Response(
        JSON.stringify({ error: `Erro ao consultar tabela "${table}".`, detail: body }),
        { status: res.status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
      );
    }

    console.log(`[api/catalogo] Tabela "${table}" OK — ${body.length} bytes`);
    return new Response(body, {
      status: 200,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json; charset=utf-8" },
    });
  } catch (err) {
    console.error("[api/catalogo] Exceção ao consultar Supabase:", err);
    return new Response(
      JSON.stringify({ error: "Erro interno ao buscar dados. Tente novamente." }),
      { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SSR handler (TanStack Start)
// ─────────────────────────────────────────────────────────────────────────────
type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m as { default?: ServerEntry }).default ?? (m as unknown as ServerEntry),
    );
  }
  return serverEntryPromise;
}

function brandedErrorResponse(): Response {
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isCatastrophicSsrErrorBody(body: string, responseStatus: number): boolean {
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return false;
  }
  if (!payload || Array.isArray(payload) || typeof payload !== "object") return false;
  const fields = payload as Record<string, unknown>;
  const expectedKeys = new Set(["message", "status", "unhandled"]);
  if (!Object.keys(fields).every((key) => expectedKeys.has(key))) return false;
  return (
    fields.unhandled === true &&
    fields.message === "HTTPError" &&
    (fields.status === undefined || fields.status === responseStatus)
  );
}

async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;
  const body = await response.clone().text();
  if (!isCatastrophicSsrErrorBody(body, response.status)) return response;
  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return brandedErrorResponse();
}

function injectRuntimeEnv(env: unknown): void {
  if (!env || typeof env !== "object") {
    return;
  }

  const runtimeEnv = env as Record<string, unknown>;

  for (const key of RUNTIME_ENV_KEYS) {
    const value = runtimeEnv[key];
    if (typeof value === "string" && value) {
      (globalThis as Record<string, unknown>)[`__${key}__`] = value;
    }
  }
}

const DEFAULT_HOME_CONFIG = {
  order: ["meusArtistas", "billboard", "topPlataformas"] as string[],
  sections: {
    meusArtistas: { enabled: true },
    billboard: {
      enabled: true,
      fallbackUrl: "https://empirerpg-max.github.io/central/charts.html?tab=BILLBOARD%20HOT%20100",
    },
    topPlataformas: {
      enabled: true,
      links: {
        spotify: "https://empirerpg-max.github.io/central/charts.html?tab=SPOTIFY",
        apple_music: "https://empirerpg-max.github.io/central/charts.html?tab=APPLE%20MUSIC",
        youtube: "https://empirerpg-max.github.io/central/charts.html?tab=YOUTUBE",
        billboard_200:
          "https://empirerpg-max.github.io/central/charts.html?tab=DADOS%20%C3%81LBUNS",
        digital_sales: "https://empirerpg-max.github.io/central/charts.html?tab=DIGITAL%20SALES",
      } as Record<string, string>,
    },
  },
};

type FlagsKv = {
  get: (key: string) => Promise<string | null>;
  put: (key: string, value: string) => Promise<void>;
};

function deepMerge<T>(base: T, override: unknown): T {
  if (!override || typeof override !== "object") return base;
  const result: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(override as Record<string, unknown>)) {
    const current = result[key];
    result[key] =
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      current &&
      typeof current === "object"
        ? deepMerge(current, value)
        : value;
  }
  return result as T;
}

async function handleHomeConfigApi(env: { FLAGS?: FlagsKv }): Promise<Response> {
  if (!env.FLAGS) {
    return Response.json(DEFAULT_HOME_CONFIG, {
      headers: { "Cache-Control": "public, max-age=15" },
    });
  }
  const raw = await env.FLAGS.get("home-config");
  const config = raw ? deepMerge(DEFAULT_HOME_CONFIG, JSON.parse(raw)) : DEFAULT_HOME_CONFIG;
  return Response.json(config, { headers: { "Cache-Control": "public, max-age=15" } });
}

const MAX_ERROR_LOG_ENTRIES = 50;

async function handleLogErrorApi(request: Request, env: { FLAGS?: FlagsKv }): Promise<Response> {
  if (!env.FLAGS) return new Response(null, { status: 204 });
  let body: { message?: string; stack?: string; path?: string };
  try {
    body = await request.json();
  } catch {
    return new Response(null, { status: 204 });
  }
  const entry = {
    ts: Date.now(),
    source: "client",
    message: String(body.message || "Erro desconhecido").slice(0, 500),
    stack: body.stack ? String(body.stack).slice(0, 2000) : undefined,
    path: body.path ? String(body.path).slice(0, 200) : undefined,
  };
  const raw = await env.FLAGS.get("error-log");
  const list = raw ? JSON.parse(raw) : [];
  list.unshift(entry);
  await env.FLAGS.put("error-log", JSON.stringify(list.slice(0, MAX_ERROR_LOG_ENTRIES)));
  return new Response(null, { status: 204 });
}

async function logServerError(env: { FLAGS?: FlagsKv }, error: unknown, path?: string) {
  if (!env.FLAGS) return;
  try {
    const entry = {
      ts: Date.now(),
      source: "server",
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack?.slice(0, 2000) : undefined,
      path,
    };
    const raw = await env.FLAGS.get("error-log");
    const list = raw ? JSON.parse(raw) : [];
    list.unshift(entry);
    await env.FLAGS.put("error-log", JSON.stringify(list.slice(0, MAX_ERROR_LOG_ENTRIES)));
  } catch {
    // Nunca deixar o log de erro derrubar a resposta original.
  }
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    const url = new URL(request.url);

    injectRuntimeEnv(env);

    const empirePlayResponse = await handleEmpireApiRoutes(request);
    if (empirePlayResponse) {
      return empirePlayResponse;
    }

    // Intercepta /api/catalogo antes do SSR
    if (url.pathname.startsWith("/api/catalogo")) {
      return handleCatalogoApi(request);
    }

    // Config da Home (seções, ordem, textos/links), gerida pelo Empire Admin (mesmo KV).
    if (url.pathname === "/api/flags" && request.method === "GET") {
      return handleHomeConfigApi(env as { FLAGS?: FlagsKv });
    }

    // Log de erros do cliente (blank screens, exceptions), lido pelo Empire Admin.
    if (url.pathname === "/api/log-error" && request.method === "POST") {
      return handleLogErrorApi(request, env as { FLAGS?: FlagsKv });
    }

    // Proxy de vídeos grandes do Telegram (Music Videos).
    if (url.pathname.startsWith("/api/telegram-video/") && request.method === "GET") {
      const messageId = url.pathname.slice("/api/telegram-video/".length);
      return handleTelegramVideoProxy(
        request,
        env as { TELEGRAM_MEDIA_SERVICE_URL?: string; TELEGRAM_MEDIA_ADMIN_TOKEN?: string },
        messageId,
      );
    }

    // Rota normal: SSR do TanStack Start
    try {
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      console.error(error);
      await logServerError(env as { FLAGS?: FlagsKv }, error, url.pathname);
      return brandedErrorResponse();
    }
  },
};

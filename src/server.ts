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

  // O serviço no Render (plano gratuito) às vezes trava — "acordando" de um
  // sono prolongado, sobrecarregado por outro download simultâneo, ou preso
  // numa mensagem gigante do Telegram. Sem prazo aqui, a requisição fica
  // pendurada pro sempre e o player só mostra uma tela de carregando infinita.
  // Um teto curto transforma isso num erro rápido e claro, que o player já
  // sabe mostrar com um botão de link direto — melhor do que travar.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, { headers, signal: controller.signal });
  } catch (error: any) {
    const timedOut = error?.name === "AbortError";
    return new Response(
      timedOut
        ? "O serviço de vídeo do Telegram demorou demais para responder (pode estar acordando ou sobrecarregado). Tente novamente em instantes."
        : "Falha ao conectar com o serviço de vídeo do Telegram.",
      { status: timedOut ? 504 : 502 },
    );
  } finally {
    clearTimeout(timeout);
  }
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
  "DRIVE_OAUTH_CLIENT_ID",
  "DRIVE_OAUTH_CLIENT_SECRET",
  "DRIVE_OAUTH_REFRESH_TOKEN",
  "RESEND_API_KEY",
  "SESSION_TOKEN_SECRET",
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
  // Roda a cada 10 min (ver wrangler.jsonc, "triggers.crons") — processa
  // transmissões da Empire TV recém-encerradas e grava a participação dos
  // jogadores (presença + chat) em REGISTRO.
  async scheduled(_event: unknown, env: unknown, ctx: { waitUntil: (p: Promise<unknown>) => void }) {
    injectRuntimeEnv(env);
    const { processarParticipacaoTV } = await import("../backend/src/controllers/tvController");
    ctx.waitUntil(
      processarParticipacaoTV()
        .then((r) =>
          console.log(
            `[scheduled] Participação TV: ${r.transmissoesProcessadas} transmissões, ${r.registrosGravados} registros.`,
          ),
        )
        .catch((err) => console.error("[scheduled] Erro ao processar participação TV:", err)),
    );
  },

  async fetch(request: Request, env: unknown, ctx: unknown) {
    const url = new URL(request.url);

    injectRuntimeEnv(env);

    // Sem esse try/catch, qualquer controller de backend que deixasse uma
    // exceção escapar (leitura de planilha falhando, etc) virava um erro cru
    // do Worker em vez de uma resposta JSON — o frontend não tinha como
    // distinguir isso de "deu tudo certo, só não tem dado", e a tela
    // mostrava vazio em vez de um erro real pra tentar de novo.
    let empirePlayResponse: Response | null;
    try {
      empirePlayResponse = await handleEmpireApiRoutes(request);
    } catch (error) {
      console.error("[handleEmpireApiRoutes] Erro não tratado:", error);
      empirePlayResponse = url.pathname.startsWith("/api/")
        ? new Response(JSON.stringify({ success: false, error: "Erro interno no servidor." }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          })
        : null;
    }
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
    // Leitura direta do error-log (mesmo dado que o Empire Admin lê) — só
    // consulta, nunca escreve nada além do que /api/log-error já grava.
    if (url.pathname === "/api/debug/error-log" && request.method === "GET") {
      const flags = env as { FLAGS?: FlagsKv };
      const raw = flags.FLAGS ? await flags.FLAGS.get("error-log") : null;
      return Response.json({ raw: raw ? JSON.parse(raw) : [] });
    }

    // Debug temporário: corrige de vez o álbum "Underwooding" (SA5M) que
    // tinha sido upado com o bug de desvio de coluna, antes do fix. Reescreve
    // a linha do álbum (Playlists_Albuns!17) e as 12 faixas (Playlists_Faixas!
    // 204-215) na disposição correta, limpando qualquer sobra deslocada.
    if (url.pathname === "/api/debug/corrigir-album-sa5m" && request.method === "GET") {
      const gs = await import("../backend/src/services/googleSheetsService");

      // Álbum — dados recuperados da linha 17 deslocada (gênero, data, capa,
      // encarte, telegram_id, created_at) + id/artista (achados nas faixas)
      // + título (confirmado com o usuário, não estava gravado em lugar
      // nenhum).
      await gs.googleSheetsService.usuarios.updateValues("Playlists_Albuns", "A17:S17", [
        [
          "ALB-8b2a9a28",
          "SA5M",
          "Underwooding",
          "Pop/Dance",
          "2009-11-25",
          "",
          "https://drive.google.com/file/d/1AVt962A4RGecQl_Ayu-6BeRJnbRm3d0M/view?usp=drivesdk",
          "",
          "[]",
          "5031494795",
          "2026-08-25T17:48:28.220Z",
          "", "", "", "", "", "", "", "",
        ],
      ]);

      const faixasReais = [
        { linha: 204, numero: 1, titulo: "Darkness", url: "https://youtu.be/EDS52OGoH1g?is=mu0NLMOX1zsW876a" },
        { linha: 205, numero: 2, titulo: "How You Love Me Now", url: "https://youtu.be/0oekuvLEKFY?is=xCH9IKZuRRBOzhHO" },
        { linha: 206, numero: 3, titulo: "Loserboy", url: "https://youtu.be/cazmO9ZvgUI?is=CyBvw6l6J3SXI_WO" },
        { linha: 207, numero: 4, titulo: "After Dark", url: "https://youtu.be/Q0SKBXfVXww?is=3_oiGZfkuP1ROC5W" },
        { linha: 208, numero: 5, titulo: "Pleasure Holic (feat. Prince Spears)", url: "https://youtu.be/IjEUs54tevw?is=wWF5cojW_CVbHPHF" },
        { linha: 209, numero: 6, titulo: "Tonight", url: "https://youtu.be/1rMF565C7XY?is=QoQhmXG8scg3AAYM" },
        { linha: 210, numero: 7, titulo: "Play Me Like A Toy", url: "https://youtu.be/6n7v_j85FXg?is=V1cwzg0VGUQKS2ev" },
        { linha: 211, numero: 8, titulo: "Somebody New", url: "https://youtu.be/Ctssms_PKLw?is=jQWFaeC_YTqLrztH" },
        { linha: 212, numero: 9, titulo: "Myself Travel", url: "https://youtu.be/xvkC8Q09xmQ?is=lx3Ersbxkv1I67_e" },
        { linha: 213, numero: 10, titulo: "Kiss", url: "https://youtu.be/INH5D7VmCe8?is=_yG3d1EwMWlBmRmn" },
        { linha: 214, numero: 11, titulo: "Put In My Heart", url: "https://youtu.be/Lp4WGcfLw6Y?is=tFBvLhusHg8UecT9" },
        { linha: 215, numero: 12, titulo: "Monopoly", url: "https://youtu.be/Vr49lhwcqbY?is=e3PeJFUivgQ4JvPW" },
      ];
      for (const f of faixasReais) {
        // Limpa a linha inteira (A:K, cobre a área que tinha dado shifted)
        // antes de escrever A:G corretos — sem isso, a sobra deslocada
        // (ex: drive_url antigo em K) ficava duplicada.
        await gs.googleSheetsService.usuarios.updateValues(
          "Playlists_Faixas",
          `A${f.linha}:K${f.linha}`,
          [Array(11).fill("")],
        );
        await gs.googleSheetsService.usuarios.updateValues("Playlists_Faixas", `A${f.linha}:G${f.linha}`, [
          ["ALB-8b2a9a28", String(f.numero), f.titulo, "SA5M", "", f.url, ""],
        ]);
      }

      const albumRow = await gs.googleSheetsService.usuarios.readValues("Playlists_Albuns", "A17:K17");
      const faixasRows = await gs.googleSheetsService.usuarios.readValues("Playlists_Faixas", "A204:G215");
      return Response.json({ albumRow, faixasRows });
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

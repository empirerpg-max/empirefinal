import express from "express";
import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions/index.js";

const API_ID = Number(process.env.TELEGRAM_API_ID || 0);
const API_HASH = process.env.TELEGRAM_API_HASH || "";
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";
const DEFAULT_CHAT_ID = process.env.TELEGRAM_SOURCE_CHAT_ID || "-1004353239109";

if (!API_ID || !API_HASH) {
  console.error("Faltando TELEGRAM_API_ID / TELEGRAM_API_HASH nas variáveis de ambiente.");
}
if (!ADMIN_TOKEN) {
  console.error("Faltando ADMIN_TOKEN — as rotas de login e vídeo ficarão travadas.");
}

let session = new StringSession(process.env.TELEGRAM_SESSION || "");
let client = new TelegramClient(session, API_ID, API_HASH, { connectionRetries: 5 });
let clientReady = false;

async function ensureConnected() {
  if (!clientReady) {
    await client.connect();
    clientReady = true;
  }
}

function requireAdmin(req: express.Request, res: express.Response): boolean {
  const token = req.header("x-admin-token");
  if (!ADMIN_TOKEN || token !== ADMIN_TOKEN) {
    res.status(401).json({ error: "Não autorizado." });
    return false;
  }
  return true;
}

const app = express();
app.use(express.json());

app.get("/health", async (_req, res) => {
  res.json({ ok: true, loggedIn: await client.checkAuthorization().catch(() => false) });
});

// Passo 1 do login único: envia o código de confirmação pro seu Telegram.
app.post("/auth/send-code", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const { phone } = req.body as { phone?: string };
  if (!phone) return res.status(400).json({ error: "Informe 'phone' no formato internacional, ex: +5511999999999." });
  try {
    await ensureConnected();
    const result = await client.sendCode({ apiId: API_ID, apiHash: API_HASH }, phone);
    res.json({ phoneCodeHash: result.phoneCodeHash });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Passo 2: confirma com o código recebido (e senha de duas etapas, se você tiver).
app.post("/auth/confirm", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const { phone, code, phoneCodeHash, password } = req.body as {
    phone?: string;
    code?: string;
    phoneCodeHash?: string;
    password?: string;
  };
  if (!phone || !code || !phoneCodeHash) {
    return res.status(400).json({ error: "Informe 'phone', 'code' e 'phoneCodeHash'." });
  }
  try {
    await ensureConnected();
    try {
      await client.invoke(
        new Api.auth.SignIn({ phoneNumber: phone, phoneCodeHash, phoneCode: code })
      );
    } catch (err: any) {
      if (err?.errorMessage === "SESSION_PASSWORD_NEEDED") {
        if (!password) {
          return res.status(401).json({ error: "Sua conta tem senha de duas etapas. Reenvie com 'password'." });
        }
        await client.signInWithPassword(
          { apiId: API_ID, apiHash: API_HASH },
          { password: async () => password, onError: async (e) => { throw e; } }
        );
      } else {
        throw err;
      }
    }
    const sessionString = client.session.save() as unknown as string;
    res.json({
      ok: true,
      sessionString,
      note: "Copie 'sessionString' e salve como o secret TELEGRAM_SESSION no serviço, depois reinicie/redeploy.",
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Transmite um vídeo do grupo do Telegram, com suporte a Range (permite arrastar a barra de progresso).
app.get("/video/:messageId", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const chatId = (req.query.chatId as string) || DEFAULT_CHAT_ID;
  const messageId = Number(req.params.messageId);
  if (!messageId) return res.status(400).json({ error: "messageId inválido." });

  try {
    await ensureConnected();
    const messages = await client.getMessages(chatId, { ids: [messageId] });
    const message = messages[0];
    if (!message || !message.media) {
      return res.status(404).json({ error: "Mensagem ou mídia não encontrada." });
    }

    const document = (message.media as any)?.document;
    const totalSize: number | undefined = document?.size?.toJSNumber?.();
    const mimeType = document?.mimeType || "video/mp4";

    const range = req.headers.range;
    let start = 0;
    let end = totalSize ? totalSize - 1 : undefined;

    if (range && totalSize) {
      const match = /bytes=(\d*)-(\d*)/.exec(range);
      if (match) {
        if (match[1]) start = parseInt(match[1], 10);
        if (match[2]) end = parseInt(match[2], 10);
      }
    }

    res.setHeader("Content-Type", mimeType);
    res.setHeader("Accept-Ranges", "bytes");

    if (range && totalSize && end !== undefined) {
      res.status(206);
      res.setHeader("Content-Range", `bytes ${start}-${end}/${totalSize}`);
      res.setHeader("Content-Length", String(end - start + 1));
    } else if (totalSize) {
      res.setHeader("Content-Length", String(totalSize));
    }

    const iter = client.iterDownload({
      file: message.media as any,
      offset: BigInt(start) as any,
      requestSize: 512 * 1024,
    });

    let sent = 0;
    const wanted = end !== undefined ? end - start + 1 : undefined;
    for await (const chunk of iter) {
      if (wanted !== undefined && sent + chunk.length > wanted) {
        res.write(chunk.subarray(0, wanted - sent));
        break;
      }
      res.write(chunk);
      sent += chunk.length;
      if (wanted !== undefined && sent >= wanted) break;
    }
    res.end();
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    else res.end();
  }
});

const port = Number(process.env.PORT || 8080);
app.listen(port, () => console.log(`empire-telegram-media ouvindo na porta ${port}`));

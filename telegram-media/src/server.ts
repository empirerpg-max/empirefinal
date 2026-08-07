import express from "express";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";

const API_ID = Number(process.env.TELEGRAM_API_ID || 0);
const API_HASH = process.env.TELEGRAM_API_HASH || "";
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";
const DEFAULT_CHAT_ID = process.env.TELEGRAM_SOURCE_CHAT_ID || "-1004353239109";

if (!API_ID || !API_HASH || !BOT_TOKEN) {
  console.error("Faltando TELEGRAM_API_ID / TELEGRAM_API_HASH / TELEGRAM_BOT_TOKEN nas variáveis de ambiente.");
}
if (!ADMIN_TOKEN) {
  console.error("Faltando ADMIN_TOKEN — a rota de vídeo ficará travada.");
}

// Login de bot via MTProto (não a API HTTP do bot): sem o limite de 20MB,
// e sem precisar de número de telefone/SMS — é automático a cada boot.
const client = new TelegramClient(new StringSession(""), API_ID, API_HASH, {
  connectionRetries: 5,
});
const ready = client.start({ botAuthToken: BOT_TOKEN });
ready.catch((err) => console.error("Erro no login do bot:", err));

function requireAdmin(req: express.Request, res: express.Response): boolean {
  const token = req.header("x-admin-token");
  if (!ADMIN_TOKEN || token !== ADMIN_TOKEN) {
    res.status(401).json({ error: "Não autorizado." });
    return false;
  }
  return true;
}

const app = express();

app.get("/health", async (_req, res) => {
  try {
    await ready;
    res.json({ ok: true, loggedIn: await client.checkAuthorization().catch(() => false) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

// Alinhamento exigido pelo MTProto para upload.getFile: offset múltiplo de
// 4096 bytes, e cada pedaço pedido não pode passar de 1MB.
const MTPROTO_ALIGN = 4096;
const MAX_CHUNK = 1024 * 1024;

function alignDown(n: number, align: number) {
  return n - (n % align);
}

// Transmite um vídeo do grupo do Telegram, com suporte a Range (permite arrastar a barra de progresso).
app.get("/video/:messageId", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const chatId = (req.query.chatId as string) || DEFAULT_CHAT_ID;
  const messageId = Number(req.params.messageId);
  if (!messageId) return res.status(400).json({ error: "messageId inválido." });

  try {
    await ready;
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

    const wanted = end !== undefined ? end - start + 1 : undefined;
    // Baixa a partir do bloco alinhado que contém `start`, e descarta o
    // excedente antes de começar a escrever a resposta.
    const alignedStart = alignDown(start, MTPROTO_ALIGN);
    let skip = start - alignedStart;
    let sent = 0;

    const iter = client.iterDownload({
      file: message.media as any,
      offset: BigInt(alignedStart) as any,
      requestSize: MAX_CHUNK,
    });

    for await (const chunk of iter) {
      let piece: Buffer = chunk as Buffer;
      if (skip > 0) {
        if (skip >= piece.length) {
          skip -= piece.length;
          continue;
        }
        piece = piece.subarray(skip);
        skip = 0;
      }
      if (wanted !== undefined && sent + piece.length > wanted) {
        res.write(piece.subarray(0, wanted - sent));
        sent = wanted;
        break;
      }
      res.write(piece);
      sent += piece.length;
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

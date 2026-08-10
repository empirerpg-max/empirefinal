import { sheetsService } from "../services/sheetsService";
import { normalizeText } from "../services/googleSheetsService";
import { readRuntimeEnv } from "../google/service-account";

// "Videos" não existe mais como aba própria — consolidada em "Music Videos".
const SHEET_LABELS: Record<string, string> = {
  musicas: "Musicas",
  music_videos: "Music Videos",
  videos: "Music Videos",
  albuns: "Albuns",
};

const NOTIFY_EMAIL = "empirerpg.forum@gmail.com";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function columnLetter(zeroBasedIndex: number): string {
  let n = zeroBasedIndex + 1;
  let letters = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

/**
 * POST /api/empire-play/report-wrong-content
 * body: { itemId, title, artist, reporterName? }
 *
 * O jogador reporta que o conteúdo aberto (vídeo/música baixado errado,
 * fora de posição, etc) não corresponde ao que deveria — diferente do
 * "Reportar problema" de vídeo travado, aqui é sobre o CONTEÚDO estar
 * trocado. Marca a linha na planilha e avisa por e-mail.
 */
export async function reportWrongContentController(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as {
      itemId?: string;
      title?: string;
      artist?: string;
      reporterName?: string;
    };
    const itemId = normalizeText(body.itemId);
    if (!itemId) {
      return jsonResponse({ success: false, error: "itemId inválido." }, 400);
    }

    const match = itemId.match(/^([a-z_]+)_(\d+)$/);
    const sheetName = match ? SHEET_LABELS[match[1]] : undefined;
    if (!match || !sheetName) {
      return jsonResponse({ success: false, error: "itemId não reconhecido." }, 400);
    }

    // O id é montado como `${sheetName}_${index+1}` (index 0-based dentro
    // dos dados, sem o cabeçalho) — a linha real na planilha é index+2.
    const sheetRow = Number(match[2]) + 1;

    const rows = await sheetsService.readValues(sheetName);
    const header = rows[0] || [];
    let col = header.findIndex((h) =>
      normalizeText(h).toLowerCase().includes("reportado como incorreto"),
    );
    if (col < 0) {
      col = header.length;
      await sheetsService.updateValues(sheetName, `${columnLetter(col)}1`, [
        ["Reportado como incorreto"],
      ]);
    }

    await sheetsService.updateValues(sheetName, `${columnLetter(col)}${sheetRow}`, [
      [new Date().toISOString()],
    ]);

    await sendWrongContentEmail({
      sheetName,
      sheetRow,
      title: body.title || "(sem título)",
      artist: body.artist || "",
      reporterName: body.reporterName || "",
    });

    return jsonResponse({ success: true });
  } catch (error: any) {
    console.error("[reportWrongContentController] Erro:", error);
    return jsonResponse(
      { success: false, error: error.message || "Erro ao reportar conteúdo incorreto." },
      500,
    );
  }
}

async function sendWrongContentEmail(params: {
  sheetName: string;
  sheetRow: number;
  title: string;
  artist: string;
  reporterName: string;
}): Promise<void> {
  const apiKey = readRuntimeEnv("RESEND_API_KEY");
  if (!apiKey) {
    console.warn(
      "[reportWrongContentController] RESEND_API_KEY não configurado — planilha marcada, mas e-mail não foi enviado.",
    );
    return;
  }

  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Empire Play <onboarding@resend.dev>",
        to: NOTIFY_EMAIL,
        subject: `Empire Play: conteúdo reportado como incorreto — "${params.title}"`,
        text:
          `Um jogador reportou que o conteúdo abaixo está incorreto (arquivo errado, posição trocada, etc):\n\n` +
          `Título: ${params.title}\n` +
          `Artista: ${params.artist || "-"}\n` +
          `Aba: ${params.sheetName}\n` +
          `Linha na planilha: ${params.sheetRow}\n` +
          (params.reporterName ? `Reportado por: ${params.reporterName}\n` : "") +
          `\nA coluna "Reportado como incorreto" dessa linha foi marcada com a data/hora do report.`,
      }),
    });
  } catch (err) {
    console.warn("[reportWrongContentController] Falha ao enviar e-mail:", err);
  }
}

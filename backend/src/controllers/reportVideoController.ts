import { sheetsService } from "../services/sheetsService";
import { normalizeText } from "../services/googleSheetsService";
import { readRuntimeEnv } from "../google/service-account";

const SHEET_NAME = "Music Videos";
const REPORT_PENDING_WINDOW_MS = 6 * 60 * 60 * 1000;
const GITHUB_OWNER = "empirerpg-max";
const GITHUB_REPO = "empirefinal";
const WORKFLOW_FILE = "retranscode-telegram-videos.yml";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * POST /api/empire-play/report-video-issue
 * body: { messageId: string }
 *
 * Marca a linha da aba Music Videos correspondente como "reportada" (coluna
 * "Reportado em") e dispara o workflow de reconversão só pra esse vídeo. A
 * própria planilha é a fonte da verdade de "já reportado" — não depende de
 * nenhum estado no navegador do jogador.
 */
export async function reportVideoIssueController(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as { messageId?: string };
    const messageId = normalizeText(body.messageId);
    if (!messageId || !/^\d+$/.test(messageId)) {
      return jsonResponse({ success: false, error: "messageId inválido." }, 400);
    }

    const rows = await sheetsService.readValues(SHEET_NAME);
    if (rows.length < 2) {
      return jsonResponse({ success: false, error: "Aba Music Videos vazia." }, 500);
    }

    const header = rows[0].map((h) => normalizeText(h).toLowerCase());
    const fonteCol = header.findIndex((h) => h === "fonte");
    // A aba tem duas colunas "ID da mensagem" — a do grupo de arquivo (a que
    // toca o vídeo) é a que vem depois de "fonte".
    const idMensagemCol = header.findIndex((h, i) => h.includes("id da mensagem") && i > fonteCol);
    const reconvertidoCol = header.findIndex((h) => h.includes("id da mensagem (reconvertido)"));
    let reportedAtCol = header.findIndex((h) => h.includes("reportado em"));

    if (idMensagemCol < 0) {
      return jsonResponse(
        { success: false, error: "Coluna 'ID da mensagem' não encontrada." },
        500,
      );
    }

    const rowIndex = rows.findIndex(
      (row, i) =>
        i > 0 &&
        (normalizeText(row[idMensagemCol]) === messageId ||
          (reconvertidoCol >= 0 && normalizeText(row[reconvertidoCol]) === messageId)),
    );
    if (rowIndex < 0) {
      return jsonResponse({ success: false, error: "Vídeo não encontrado na planilha." }, 404);
    }

    // Coluna "Reportado em" pode ainda não existir (só é criada pelo script
    // de reconversão na primeira execução) — nesse caso não há como já estar
    // pendente.
    if (reportedAtCol >= 0) {
      const currentValue = normalizeText(rows[rowIndex][reportedAtCol]);
      if (currentValue) {
        const reportedAt = new Date(currentValue);
        const stillPending =
          !Number.isNaN(reportedAt.getTime()) &&
          Date.now() - reportedAt.getTime() < REPORT_PENDING_WINDOW_MS;
        if (stillPending) {
          return jsonResponse(
            { success: false, error: "Esse vídeo já foi reportado e está sendo reprocessado." },
            409,
          );
        }
      }
    } else {
      // Cria a coluna agora mesmo pra já poder gravar o timestamp — mesma
      // regra do projeto de nunca inserir coluna no meio.
      reportedAtCol = header.length;
      await sheetsService.updateValues(SHEET_NAME, `${columnLetter(reportedAtCol)}1`, [
        ["Reportado em"],
      ]);
    }

    const sheetRow = rowIndex + 1;
    await sheetsService.updateValues(SHEET_NAME, `${columnLetter(reportedAtCol)}${sheetRow}`, [
      [new Date().toISOString()],
    ]);

    const dispatched = await dispatchRetranscodeWorkflow(messageId);
    if (!dispatched.ok) {
      return jsonResponse(
        { success: false, error: `Falha ao acionar o reprocessamento: ${dispatched.error}` },
        502,
      );
    }

    return jsonResponse({ success: true, message: "Reprocessamento solicitado." });
  } catch (error: any) {
    console.error("[reportVideoIssueController] Erro:", error);
    return jsonResponse(
      { success: false, error: error.message || "Erro ao reportar problema." },
      500,
    );
  }
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

async function dispatchRetranscodeWorkflow(
  messageId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const token = readRuntimeEnv("GITHUB_DISPATCH_TOKEN");
  if (!token) {
    return { ok: false, error: "GITHUB_DISPATCH_TOKEN não configurado no Worker." };
  }

  const response = await fetch(
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/${WORKFLOW_FILE}/dispatches`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "User-Agent": "empire-play-worker",
      },
      body: JSON.stringify({
        ref: "main",
        inputs: { dry_run: "false", target_message_id: messageId },
      }),
    },
  );

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    return {
      ok: false,
      error: `GitHub API respondeu HTTP ${response.status}: ${text.slice(0, 300)}`,
    };
  }
  return { ok: true };
}

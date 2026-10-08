import { DRIVE_FOLDERS, listFilesInFolder } from "../services/googleDriveService";
import { readValues, updateValues, appendRow, ensureSheetTab, normalizeText } from "../services/googleSheetsService";

// Aba de contagem de uso dos GIFs/stickers do chat da Empire TV — planilha
// Agenda_TV (mesma usada pro resto da feature de TV), já que isso é estado
// de app, não dado editorial. Colunas: FileId | Usos.
const USOS_SHEET = "TV_Chat_Gifs_Usos";

async function ensureUsosSheetPronta(): Promise<void> {
  await ensureSheetTab("agendaTV", USOS_SHEET);
  const header = await readValues("agendaTV", USOS_SHEET, "A1:B1").catch(() => []);
  if (!normalizeText(header?.[0]?.[0])) {
    await updateValues("agendaTV", USOS_SHEET, "A1:B1", [["FileId", "Usos"]]);
  }
}

async function lerUsosPorFileId(): Promise<Map<string, number>> {
  const mapa = new Map<string, number>();
  const rows = await readValues("agendaTV", USOS_SHEET, "A2:B").catch(() => []);
  for (const row of rows) {
    const fileId = normalizeText(row[0]);
    if (!fileId) continue;
    const usos = Number(row[1]) || 0;
    mapa.set(fileId, usos);
  }
  return mapa;
}

// GET /api/empire-tv/gifs — lista os GIFs/stickers já enviados por
// qualquer jogador (pasta compartilhada no Drive), pro seletor do chat da
// Empire TV. Qualquer um pode ver e usar tudo que já foi enviado.
//
// `usos` vem junto em cada item pra o frontend oferecer "Mais usados" (uso
// combinado com o uso real registrado em cada envio, não só quem subiu por
// último) e "Recentes" (a ordem natural devolvida aqui, createdTime desc —
// garante que um upload novo sempre aparece pra todo mundo, mesmo com 0
// usos ainda, em vez de afundar lá embaixo na ordenação por mais usado).
export async function listTvChatGifsController(): Promise<Response> {
  try {
    const [files, usosPorFileId] = await Promise.all([
      listFilesInFolder(DRIVE_FOLDERS.tvChatGifs, 100),
      lerUsosPorFileId().catch(() => new Map<string, number>()),
    ]);
    // Celulares costumam salvar "GIFs" na galeria como vídeo de verdade
    // (mp4/mov) em vez de .gif — filtrar só "image/" escondia esses arquivos
    // da lista (e do próprio picker de upload, via accept="image/*"),
    // fazendo o jogador não conseguir nem selecionar o próprio GIF.
    const items = files
      .filter((f) => f.mimeType.startsWith("image/") || f.mimeType.startsWith("video/"))
      .map((f) => ({
        id: f.id,
        name: f.name,
        // drive.google.com/thumbnail não é hotlinkável de forma confiável —
        // o Drive às vezes devolve uma página HTML (limite de acesso/rate
        // limit) em vez da imagem, fazendo o GIF aparecer como link quebrado
        // pra alguns jogadores. Usa o proxy autenticado (mesmo já usado pra
        // fotos de perfil/badge) que sempre devolve os bytes reais do arquivo.
        url: `/api/media/image?id=${f.id}`,
        isVideo: f.mimeType.startsWith("video/"),
        usos: usosPorFileId.get(f.id) || 0,
      }));
    return new Response(JSON.stringify({ success: true, data: items }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("[listTvChatGifsController] Erro:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message || "Erro ao listar GIFs.", data: [] }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }
}

// POST /api/empire-tv/gifs/usar — chamado toda vez que um GIF/sticker é
// REALMENTE enviado no chat (não só quando o seletor é aberto), pra contar
// uso de verdade. Body: { fileId }.
export async function registrarUsoGifController(request: Request): Promise<Response> {
  try {
    const body = await request.json().catch(() => ({}) as any);
    const fileId = normalizeText(body?.fileId);
    if (!fileId) {
      return new Response(JSON.stringify({ success: false, error: "fileId obrigatório." }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    await ensureUsosSheetPronta();
    const rows = await readValues("agendaTV", USOS_SHEET, "A2:B").catch(() => []);
    const idx = rows.findIndex((row) => normalizeText(row[0]) === fileId);
    if (idx >= 0) {
      const usos = (Number(rows[idx][1]) || 0) + 1;
      await updateValues("agendaTV", USOS_SHEET, `B${idx + 2}:B${idx + 2}`, [[String(usos)]]);
    } else {
      await appendRow("agendaTV", USOS_SHEET, [fileId, "1"]);
    }
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("[registrarUsoGifController] Erro:", error);
    // Nunca bloqueia o envio da mensagem por causa da contagem — só loga.
    return new Response(JSON.stringify({ success: false, error: error.message || "Erro." }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
}

// Upload de vídeo DIRETO do navegador para o Google Drive (spec
// docs/superpowers/specs/2026-11-18-catalogo-d1-primeiro-design.md §5).
//
// Antes o arquivo passava pelo Worker (/api/gestao/upload): o Cloudflare
// limita o tamanho do corpo da requisição e o app desistia em 45 s, então
// clipes de 100-500 MB não subiam. Agora o Worker só ABRE uma sessão de
// upload retomável na API do Drive (com o token OAuth do app, que nunca vai
// ao navegador) e devolve o endereço da sessão; o navegador envia o arquivo
// direto para o Google (src/lib/uploadVideoDireto.ts).
import { getDriveOAuthAccessToken } from "../google/service-account";
import { DRIVE_FOLDERS, trashDriveFileIfInFolders } from "../services/googleDriveService";
import { readValues } from "../services/googleSheetsService";

const MAX_BYTES = 5 * 1024 ** 3; // 5 GB
const JANELA_DESCARTE_MS = 2 * 60 * 60 * 1000; // 2 h

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** POST /api/gestao/video-upload-sessao { fileName, mimeType, size } -> { uploadUrl } */
export async function criarSessaoUploadVideoController(request: Request): Promise<Response> {
  try {
    const { fileName, mimeType, size } = (await request.json().catch(() => ({}))) as {
      fileName?: string;
      mimeType?: string;
      size?: number;
    };
    if (!fileName?.trim()) return json({ success: false, error: "Nome do arquivo ausente." }, 400);
    if (!mimeType?.startsWith("video/")) return json({ success: false, error: "Só arquivos de vídeo podem ser enviados aqui." }, 400);
    if (!size || size <= 0 || size > MAX_BYTES) return json({ success: false, error: "O vídeo precisa ter até 5 GB." }, 400);

    // A sessão só aceita o PUT do navegador se for aberta com o mesmo Origin
    // da página (CORS da API de upload do Google).
    const origin = request.headers.get("Origin") || new URL(request.url).origin;
    const token = await getDriveOAuthAccessToken();
    const res = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": mimeType,
        "X-Upload-Content-Length": String(size),
        Origin: origin,
      },
      body: JSON.stringify({ name: fileName.trim(), parents: [DRIVE_FOLDERS.musicVideos] }),
    });
    const uploadUrl = res.headers.get("Location");
    if (!res.ok || !uploadUrl) {
      const detalhe = await res.text().catch(() => "");
      return json({ success: false, error: `O Drive não abriu a sessão de upload (HTTP ${res.status}). ${detalhe.slice(0, 300)}` }, 502);
    }
    return json({ success: true, uploadUrl });
  } catch (err) {
    return json({ success: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

/**
 * POST /api/gestao/video-upload-descartar { fileId } — chamado pelo
 * navegador quando o vídeo subiu mas o cadastro falhou, pra não deixar
 * arquivo órfão. Só manda pra lixeira (recuperável) se: está na pasta de
 * vídeos do app, foi criado há menos de 2 h e não aparece em Music Videos
 * nem na fila do programa de TV.
 */
export async function descartarUploadVideoController(request: Request): Promise<Response> {
  try {
    const { fileId } = (await request.json().catch(() => ({}))) as { fileId?: string };
    const id = fileId?.match(/[-\w]{25,}/)?.[0];
    if (!id) return json({ success: false, error: "ID de arquivo inválido." }, 400);

    const token = await getDriveOAuthAccessToken();
    const meta = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?fields=createdTime,parents`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!meta.ok) return json({ success: true, descartado: false, motivo: "nao-encontrado" });
    const { createdTime } = (await meta.json()) as { createdTime?: string };
    if (!createdTime || Date.now() - new Date(createdTime).getTime() > JANELA_DESCARTE_MS) {
      return json({ success: true, descartado: false, motivo: "antigo" });
    }

    for (const aba of ["Music Videos", "VIDEOS_PENDENTES_EMPIRE_TV"]) {
      const linhas = await readValues("principal", aba);
      if (linhas.some((l) => l.some((c) => String(c).includes(id)))) {
        return json({ success: true, descartado: false, motivo: "em-uso" });
      }
    }

    const r = await trashDriveFileIfInFolders(id, [DRIVE_FOLDERS.musicVideos]);
    return json({ success: true, descartado: r === "trashed", ...(r === "trashed" ? {} : { motivo: r }) });
  } catch (err) {
    return json({ success: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

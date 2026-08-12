import { getDriveOAuthAccessToken } from "../google/service-account";

export const DRIVE_FOLDERS = {
  musicas: "1hd_ZJwbVsESwtGniorw0bxQmkhsKcslT",
  // Pasta própria só pro ARQUIVO DE ÁUDIO da música (a capa continua indo
  // pra "musicas" acima) — antes os dois caíam na mesma pasta.
  musicasAudio: "11ZX-zJZbalG7GWjXPfAhksg1k-NrJ4e6",
  albuns: "1Teo9x2yBAJSmdUV23e6cO6EkyCdddZBS",
  musicVideos: "1Jk9Jk-Zd6QAoZnW3nAqFhBiJCNAnw3wR",
  // Nenhuma pasta dedicada foi definida ainda para "Videos" (não Music
  // Video) — reaproveita a pasta de Music Videos até que uma pasta própria
  // seja criada e informada.
  videos: "1Jk9Jk-Zd6QAoZnW3nAqFhBiJCNAnw3wR",
  socialPosts: "1F4SzmnJI6j0ircv2pefXsECJzrR1l5ip",
  socialStories: "18PZtlg0NwSsc9wCGkUa-F-qgsyxx5DTc",
  socialAvatars: "1uuemSEv0mtvtFZtxJdFNjedb55tUUpDm",
  socialNews: "1ERLIAEZM_KiJBhtUOuVNyXEmsGb0pxcZ",
  playerAvatars: "14yMzU_4i2ZbySfSVP0Ug9tyxu99dgJI5",
  playlistTracks: "1l7sRj7-ibDpXLQ9lc7147PLwF5qjAdZY",
  // GIFs/stickers do chat da Empire TV — qualquer jogador pode subir um
  // arquivo aqui, e ele fica disponível pra todo mundo usar no chat.
  tvChatGifs: "10LOfKeFfmnu2xXNUXmcIY-v7XGPKtlG9",
} as const;

export interface DriveFolderFile {
  id: string;
  name: string;
  mimeType: string;
}

// Lista os arquivos de uma pasta (mais recentes primeiro) — usado pelo
// seletor de GIF/sticker compartilhado do chat da Empire TV.
export async function listFilesInFolder(folderId: string, pageSize = 100): Promise<DriveFolderFile[]> {
  const token = await getDriveOAuthAccessToken();
  const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,mimeType)&orderBy=createdTime desc&pageSize=${pageSize}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const json = (await response.json()) as any;
  if (!response.ok || !Array.isArray(json.files)) {
    console.warn("[listFilesInFolder] Erro ao listar pasta:", json);
    return [];
  }
  return json.files as DriveFolderFile[];
}

export async function deleteFileFromDrive(fileUrl: string): Promise<boolean> {
  if (!fileUrl) return false;
  try {
    const match = fileUrl.match(/(?:d\/|id=)([\w-]+)/);
    if (!match || !match[1]) return false;
    const fileId = match[1];
    const token = await getDriveOAuthAccessToken();
    const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    return response.ok;
  } catch (err) {
    console.warn("[deleteFileFromDrive] Erro ao deletar arquivo antigo:", err);
    return false;
  }
}

export async function uploadFileToDrive(
  fileName: string,
  folderId: string,
  mimeType: string,
  base64Data: string,
): Promise<string> {
  try {
    const token = await getDriveOAuthAccessToken();

    const metadata = {
      name: fileName,
      parents: [folderId],
    };

    const boundary = "-------314159265358979323846";
    const delimiter = "\r\n--" + boundary + "\r\n";
    const close_delim = "\r\n--" + boundary + "--";

    // Strip base64 data prefix if present (e.g. data:image/png;base64,... or data:video/mp4;base64,...)
    const cleanBase64 = base64Data.replace(/^data:[^;]+;base64,/, "").trim();

    const multipartRequestBody =
      delimiter +
      "Content-Type: application/json\r\n\r\n" +
      JSON.stringify(metadata) +
      delimiter +
      "Content-Type: " +
      (mimeType || "image/jpeg") +
      "\r\n" +
      "Content-Transfer-Encoding: base64\r\n\r\n" +
      cleanBase64 +
      close_delim;

    const response = await fetch(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webContentLink,webViewLink",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": `multipart/related; boundary=${boundary}`,
        },
        body: multipartRequestBody,
      },
    );

    const json = (await response.json()) as any;

    if (!response.ok || !json.id) {
      console.warn("[uploadFileToDrive] Aviso/Erro Google Drive API:", json);
      return `https://drive.google.com/drive/folders/${folderId}`;
    }

    // Set permission to anyone with link if allowed
    try {
      await fetch(`https://www.googleapis.com/drive/v3/files/${json.id}/permissions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ role: "reader", type: "anyone" }),
      });
    } catch (permErr) {
      console.warn("[uploadFileToDrive] Permissão de visualização:", permErr);
    }

    // Link oficial do Drive — antes isso caía sempre num `lh3.google.com/
    // u/0/d/...` fixo, porque o `||` depois de uma template string nunca
    // executa (string não vazia é sempre truthy). "lh3.google.com" é o
    // domínio de thumbnail de imagem do Google, não um link de arquivo de
    // verdade — não funciona pra áudio/vídeo.
    return `https://drive.google.com/file/d/${json.id}/view?usp=drivesdk`;
  } catch (err) {
    console.error("[uploadFileToDrive] Fallback por erro de upload:", err);
    return `https://drive.google.com/drive/folders/${folderId}`;
  }
}

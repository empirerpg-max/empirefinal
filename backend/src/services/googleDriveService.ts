import { getGoogleAccessToken } from "../google/service-account";

export const DRIVE_FOLDERS = {
  musicas: "1hd_ZJwbVsESwtGniorw0bxQmkhsKcslT",
  albuns: "1Teo9x2yBAJSmdUV23e6cO6EkyCdddZBS",
  musicVideos: "1Jk9Jk-Zd6QAoZnW3nAqFhBiJCNAnw3wR",
  // Nenhuma pasta dedicada foi definida ainda para "Videos" (não Music
  // Video) — reaproveita a pasta de Music Videos até que uma pasta própria
  // seja criada e informada.
  videos: "1Jk9Jk-Zd6QAoZnW3nAqFhBiJCNAnw3wR",
} as const;

export async function deleteFileFromDrive(fileUrl: string): Promise<boolean> {
  if (!fileUrl) return false;
  try {
    const match = fileUrl.match(/(?:d\/|id=)([\w-]+)/);
    if (!match || !match[1]) return false;
    const fileId = match[1];
    const token = await getGoogleAccessToken([
      "https://www.googleapis.com/auth/drive",
      "https://www.googleapis.com/auth/drive.file",
    ]);
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
    const token = await getGoogleAccessToken([
      "https://www.googleapis.com/auth/drive",
      "https://www.googleapis.com/auth/drive.file",
    ]);

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

    return (
      `https://lh3.google.com/u/0/d/${json.id}` ||
      json.webViewLink ||
      `https://drive.google.com/file/d/${json.id}/view`
    );
  } catch (err) {
    console.error("[uploadFileToDrive] Fallback por erro de upload:", err);
    return `https://drive.google.com/drive/folders/${folderId}`;
  }
}

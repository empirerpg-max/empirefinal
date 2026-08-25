// Upload genérico pro Drive via /api/gestao/upload — usado pelo material
// extra dos tópicos (Shop/Info/Visual, ver src/components/EmpirePlay/
// ExtraMaterial.tsx). Mesmo padrão (FormData primeiro, Base64 como
// fallback) já usado em Gestao.tsx, só que exportado pra reuso fora dali.
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve((reader.result as string).split(",")[1] || "");
    reader.onerror = (error) => reject(error);
  });
}

export async function uploadToDrive(
  file: File,
  folderType: "materiaisMusica" | "materiaisAlbum",
  customName?: string,
): Promise<string> {
  try {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("fileName", customName || file.name);
    formData.append("folderType", folderType);

    const res = await fetch("/api/gestao/upload", { method: "POST", body: formData });
    const data = await res.json().catch(() => null);
    if (res.ok && data?.success && data?.data?.fileUrl) return data.data.fileUrl;
  } catch (err) {
    console.warn("[driveUpload] Upload por FormData falhou, tentando Base64:", err);
  }

  const base64 = await fileToBase64(file);
  const res = await fetch("/api/gestao/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fileName: customName || file.name,
      mimeType: file.type || "image/jpeg",
      base64Data: base64,
      folderType,
    }),
  });
  const data = await res.json().catch(() => null);
  if (data?.data?.fileUrl) return data.data.fileUrl;
  throw new Error("Falha ao subir arquivo pro Drive.");
}

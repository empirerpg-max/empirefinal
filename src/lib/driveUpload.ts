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

// Upload DIRETO navegador → Google Drive, em partes de 8MB, sem o arquivo
// passar pelo servidor. Motivo: o Cloudflare limita cada requisição que
// passa pelo Worker a 100MB, e há clipes maiores que isso. O servidor só
// abre a sessão (/api/gestao/upload-sessao) e, no fim, publica o arquivo
// (/api/gestao/upload-finalizar). Partes pequenas também deixam o envio
// mais resistente a conexão ruim: se uma parte falha, só ela é reenviada.
const PARTE_BYTES = 8 * 1024 * 1024; // múltiplo de 256KB, exigido pelo Drive
const PARTE_TIMEOUT_MS = 5 * 60_000;
const TENTATIVAS_POR_PARTE = 4;

async function putComTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PARTE_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Pergunta pro Drive quantos bytes ele já recebeu (usado depois de uma
// falha, pra retomar do ponto certo). null = não deu pra saber.
async function bytesRecebidos(
  sessionUrl: string,
  total: number,
): Promise<{ completo: boolean; id?: string; proximo: number | null }> {
  const res = await putComTimeout(sessionUrl, {
    method: "PUT",
    headers: { "Content-Range": `bytes */${total}` },
  });
  if (res.status === 200 || res.status === 201) {
    const data = await res.json().catch(() => null);
    return { completo: true, id: data?.id, proximo: total };
  }
  if (res.status === 308) {
    const range = res.headers.get("range");
    const m = range?.match(/bytes=0-(\d+)/);
    return { completo: false, proximo: m ? Number(m[1]) + 1 : null };
  }
  if (res.status === 404 || res.status === 410) {
    throw new Error("A sessão de upload expirou — tente enviar de novo.");
  }
  return { completo: false, proximo: null };
}

export async function uploadDiretoDrive(
  file: File,
  folderType: string,
  fileName: string,
  onProgress?: (fracao: number) => void,
): Promise<string> {
  const total = file.size;
  if (!total) throw new Error("Arquivo vazio — selecione o arquivo de novo.");

  const sessaoRes = await fetch("/api/gestao/upload-sessao", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fileName,
      folderType,
      mimeType: file.type || "application/octet-stream",
      size: total,
    }),
  });
  const sessao = await sessaoRes.json().catch(() => null);
  const sessionUrl: string | undefined = sessao?.data?.sessionUrl;
  if (!sessaoRes.ok || !sessionUrl) {
    throw new Error(sessao?.error || `Não foi possível abrir o upload (erro ${sessaoRes.status}).`);
  }

  let offset = 0;
  let fileId: string | undefined;
  while (!fileId) {
    const fim = Math.min(offset + PARTE_BYTES, total);
    let ok = false;
    for (let tentativa = 1; tentativa <= TENTATIVAS_POR_PARTE && !ok; tentativa++) {
      try {
        const res = await putComTimeout(sessionUrl, {
          method: "PUT",
          headers: { "Content-Range": `bytes ${offset}-${fim - 1}/${total}` },
          body: file.slice(offset, fim),
        });
        if (res.status === 200 || res.status === 201) {
          const data = await res.json().catch(() => null);
          if (!data?.id) throw new Error("Drive não devolveu o ID do arquivo.");
          fileId = data.id;
          ok = true;
        } else if (res.status === 308) {
          const m = res.headers.get("range")?.match(/bytes=0-(\d+)/);
          offset = m ? Number(m[1]) + 1 : fim;
          ok = true;
        } else if (res.status === 404 || res.status === 410) {
          throw new Error("A sessão de upload expirou — tente enviar de novo.");
        } else {
          throw new Error(`Drive respondeu ${res.status}`);
        }
      } catch (err) {
        if (err instanceof Error && /expirou/.test(err.message)) throw err;
        if (tentativa === TENTATIVAS_POR_PARTE) throw err;
        console.warn(`[uploadDiretoDrive] Parte ${offset}-${fim} falhou (tentativa ${tentativa}):`, err);
        await new Promise((r) => setTimeout(r, 1000 * 2 ** tentativa));
        // Retoma do ponto que o Drive confirma ter recebido, se der pra saber.
        try {
          const estado = await bytesRecebidos(sessionUrl, total);
          if (estado.completo && estado.id) {
            fileId = estado.id;
            ok = true;
          } else if (estado.proximo !== null && estado.proximo !== offset) {
            offset = estado.proximo;
            ok = true; // recomeça o laço externo a partir do novo offset
          }
        } catch (e) {
          if (e instanceof Error && /expirou/.test(e.message)) throw e;
        }
      }
    }
    onProgress?.(fileId ? 1 : offset / total);
  }

  const finRes = await fetch("/api/gestao/upload-finalizar", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileId }),
  });
  const fin = await finRes.json().catch(() => null);
  if (!finRes.ok || !fin?.data?.fileUrl) {
    throw new Error(fin?.error || `Não foi possível finalizar o upload (erro ${finRes.status}).`);
  }
  return fin.data.fileUrl as string;
}

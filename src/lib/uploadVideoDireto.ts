// Envia um arquivo de vídeo DIRETO do navegador para o Google Drive, sem
// passar pelo Worker (que tem limite de tamanho por requisição e cortava
// clipes grandes). O Worker só abre a sessão de upload
// (/api/gestao/video-upload-sessao) — ver videoUploadSessaoController.ts.
//
// Falha de rede no meio do envio: tenta de novo do zero com uma sessão
// nova, até 2 vezes. Progresso real (0-100) pelo callback.
const TENTATIVAS = 3;

async function abrirSessao(file: File, nome: string): Promise<string> {
  const res = await fetch("/api/gestao/video-upload-sessao", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileName: nome, mimeType: file.type || "video/mp4", size: file.size }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.success || !data.uploadUrl) {
    throw new Error(data?.error || "Não foi possível iniciar o envio do vídeo.");
  }
  return data.uploadUrl as string;
}

function enviar(uploadUrl: string, file: File, onProgresso: (pct: number) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", uploadUrl);
    xhr.setRequestHeader("Content-Type", file.type || "video/mp4");
    xhr.upload.onprogress = (e: ProgressEvent) => {
      if (e.lengthComputable) onProgresso(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const id = JSON.parse(xhr.responseText)?.id;
          if (id) return resolve(id);
        } catch {
          /* cai no reject abaixo */
        }
      }
      reject(new Error(`O Google recusou o envio (HTTP ${xhr.status}).`));
    };
    xhr.onerror = () => reject(new Error("A conexão caiu durante o envio."));
    xhr.send(file);
  });
}

/** Devolve o link do arquivo no Drive, no mesmo formato que o app já grava. */
export async function uploadVideoDireto(file: File, nome: string, onProgresso: (pct: number) => void): Promise<string> {
  let ultimoErro: Error | null = null;
  for (let tentativa = 1; tentativa <= TENTATIVAS; tentativa++) {
    try {
      const uploadUrl = await abrirSessao(file, nome);
      const id = await enviar(uploadUrl, file, onProgresso);
      return `https://drive.google.com/file/d/${id}/view?usp=drivesdk`;
    } catch (err) {
      ultimoErro = err instanceof Error ? err : new Error(String(err));
    }
  }
  throw new Error(
    `Não foi possível enviar o vídeo depois de ${TENTATIVAS} tentativas (${ultimoErro?.message}). Verifique a conexão e tente de novo.`,
  );
}

/** Manda para a lixeira um vídeo que subiu mas cujo cadastro falhou (não deixa arquivo órfão). */
export async function descartarVideoEnviado(link: string): Promise<void> {
  const fileId = link.match(/[-\w]{25,}/)?.[0];
  if (!fileId) return;
  await fetch("/api/gestao/video-upload-descartar", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileId }),
  }).catch(() => {});
}

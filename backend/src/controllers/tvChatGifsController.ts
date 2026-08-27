import { DRIVE_FOLDERS, listFilesInFolder } from "../services/googleDriveService";

// GET /api/empire-tv/gifs — lista os GIFs/stickers já enviados por
// qualquer jogador (pasta compartilhada no Drive), pro seletor do chat da
// Empire TV. Qualquer um pode ver e usar tudo que já foi enviado.
export async function listTvChatGifsController(): Promise<Response> {
  try {
    const files = await listFilesInFolder(DRIVE_FOLDERS.tvChatGifs, 100);
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

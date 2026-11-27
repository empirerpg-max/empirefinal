// Um post do Social precisa de ALGUM conteúdo: legenda, mídia (foto/vídeo,
// inclusive Story) ou material do catálogo (música/álbum). A legenda é
// opcional quando há mídia ou material — antes o servidor exigia texto e
// recusava Story/Feed/TikTok só com a imagem ("Dados incompletos"), mesmo
// com a tela dizendo "Legenda (opcional)".
export function postTemConteudo(p: { texto?: string; media_url?: string; material?: unknown }): boolean {
  return !!p.texto?.trim() || !!p.media_url?.trim() || !!p.material;
}

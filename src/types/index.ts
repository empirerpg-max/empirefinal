// ============================================================
// Empire Play — Tipos centrais do domínio
// ============================================================

/**
 * Representa uma obra de mídia (Música ou Vídeo).
 * Espelha as colunas do Google Sheets gerenciado pelo Apps Script.
 */
export interface Obra {
  /** ID único do tópico no Telegram (ou identificador no Sheet) */
  id_do_topico: string;
  /** Título da obra */
  nome: string;
  /** Nome do artista / criador */
  nome_do_criador: string;
  /**
   * URL da capa (imagem).
   * Para músicas geralmente é 'capa'; para vídeos pode ser 'thumb'.
   */
  capa: string;
  /** Letra completa da música (pode ser vazia para vídeos) */
  letra: string;
  /** File ID do arquivo de mídia no servidor do Telegram */
  telegram_file_id: string;
}

/**
 * Representa um comentário feito por um jogador em uma obra.
 */
export interface Comentario {
  /** ID do tópico ao qual o comentário pertence */
  id_do_topico: string;
  /** ID do jogador no Telegram */
  id_do_jogador: string;
  /** Nome de exibição do jogador */
  nome_do_jogador: string;
  /** Texto do comentário */
  comentario: string;
  /** Data/hora de criação (ISO 8601 ou string formatada pelo GAS) */
  data: string;
}

// ============================================================
// Tipos de Request / Response das chamadas à API GAS
// ============================================================

/** Payload enviado ao endpoint de comentários (POST) */
export interface PostComentarioPayload {
  id_do_topico: string;
  id_do_jogador: string;
  nome_do_jogador: string;
  comentario: string;
}

/** Payload enviado ao endpoint de upload de mídia (POST) */
export interface UploadMidiaPayload {
  /** Nome do arquivo com extensão (ex: "musica.mp3") */
  nome_arquivo: string;
  /** MIME type do arquivo (ex: "audio/mpeg") */
  mime_type: string;
  /** Conteúdo do arquivo codificado em Base64 */
  base64: string;
  /** Metadados opcionais para associar a obra ao arquivo */
  id_do_topico?: string;
}

/** Resposta genérica da API GAS */
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

/** Resposta do upload contendo o file_id atribuído pelo Telegram */
export interface UploadMidiaResponse {
  telegram_file_id: string;
  url?: string;
}

// ============================================================
// Tipos auxiliares para SWR
// ============================================================

/** Parâmetros usados como chave SWR para buscar obras */
export interface ObrasFetchKey {
  endpoint: 'obras';
  tipo?: 'musica' | 'video';
}

/** Parâmetros usados como chave SWR para buscar comentários de uma obra */
export interface ComentariosFetchKey {
  endpoint: 'comentarios';
  id_do_topico: string;
}

import useSWR, { type SWRConfiguration } from 'swr';
import type {
  Obra,
  Comentario,
  PostComentarioPayload,
  UploadMidiaPayload,
  ApiResponse,
  UploadMidiaResponse,
  ObrasFetchKey,
  ComentariosFetchKey,
} from '@/types';

// ============================================================
// Configuração base
// ============================================================

/**
 * URL base da API Google Apps Script.
 * Defina VITE_GAS_API_URL no seu arquivo .env:
 *   VITE_GAS_API_URL=https://script.google.com/macros/s/SEU_DEPLOYMENT_ID/exec
 */
const API_BASE_URL = import.meta.env.VITE_GAS_API_URL as string;

if (!API_BASE_URL) {
  console.warn(
    '[Empire Play API] VITE_GAS_API_URL não está definido. ' +
    'Adicione-o ao arquivo .env antes de iniciar a aplicação.',
  );
}

/** Opções SWR padrão para toda a aplicação */
const DEFAULT_SWR_CONFIG: SWRConfiguration = {
  /** Revalida ao focar a janela (útil no Telegram Mini App) */
  revalidateOnFocus: true,
  /** Revalida ao reconectar (ex.: saiu e voltou ao chat) */
  revalidateOnReconnect: true,
  /** Deduplica requisições dentro de 5 segundos */
  dedupingInterval: 5_000,
  /** Mantém dado anterior visível enquanto revalida (sem flash de loading) */
  keepPreviousData: true,
};

// ============================================================
// Fetcher genérico (GET)
// ============================================================

/**
 * Fetcher base para o SWR.
 * Recebe uma URL completa (com query params já incluídos) e
 * retorna o JSON parseado, ou lança um erro tipado.
 */
async function fetcher<T>(url: string): Promise<T> {
  const response = await fetch(url);

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `[Empire Play API] Erro HTTP ${response.status}: ${errorBody}`,
    );
  }

  const json: ApiResponse<T> = await response.json();

  if (!json.success) {
    throw new Error(
      `[Empire Play API] Erro da API: ${json.error ?? 'Resposta inválida'}`,
    );
  }

  return json.data as T;
}

/** Constrói uma URL com query params a partir de um objeto */
function buildUrl(
  base: string,
  params: Record<string, string | undefined>,
): string {
  const url = new URL(base);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined) url.searchParams.set(key, value);
  });
  return url.toString();
}

// ============================================================
// Hooks SWR — Leitura de dados (GET)
// ============================================================

/**
 * Busca a lista de obras (músicas ou vídeos).
 *
 * @example
 * const { obras, isLoading, error } = useObras({ tipo: 'musica' });
 */
export function useObras(params: Omit<ObrasFetchKey, 'endpoint'> = {}) {
  const key: ObrasFetchKey = { endpoint: 'obras', ...params };

  const url = buildUrl(API_BASE_URL, {
    action: 'getObras',
    tipo: params.tipo,
  });

  const { data, error, isLoading, isValidating, mutate } = useSWR<Obra[]>(
    [key, url],
    ([, resolvedUrl]) => fetcher<Obra[]>(resolvedUrl as string),
    DEFAULT_SWR_CONFIG,
  );

  return {
    obras: data ?? [],
    isLoading,
    isValidating,
    error,
    mutate,
  };
}

/**
 * Busca uma única obra pelo id_do_topico.
 *
 * @example
 * const { obra, isLoading } = useObra('123');
 */
export function useObra(id_do_topico: string) {
  const url = buildUrl(API_BASE_URL, {
    action: 'getObra',
    id_do_topico,
  });

  const { data, error, isLoading, isValidating, mutate } = useSWR<Obra>(
    id_do_topico ? ['obra', id_do_topico, url] : null,
    ([, , resolvedUrl]) => fetcher<Obra>(resolvedUrl as string),
    DEFAULT_SWR_CONFIG,
  );

  return {
    obra: data,
    isLoading,
    isValidating,
    error,
    mutate,
  };
}

/**
 * Busca os comentários de uma obra específica.
 *
 * @example
 * const { comentarios, isLoading } = useComentarios('123');
 */
export function useComentarios(id_do_topico: string) {
  const key: ComentariosFetchKey = { endpoint: 'comentarios', id_do_topico };

  const url = buildUrl(API_BASE_URL, {
    action: 'getComentarios',
    id_do_topico,
  });

  const { data, error, isLoading, isValidating, mutate } = useSWR<Comentario[]>(
    id_do_topico ? [key, url] : null,
    ([, resolvedUrl]) => fetcher<Comentario[]>(resolvedUrl as string),
    DEFAULT_SWR_CONFIG,
  );

  return {
    comentarios: data ?? [],
    isLoading,
    isValidating,
    error,
    mutate,
  };
}

// ============================================================
// Funções de mutação — Escrita de dados (POST)
// ============================================================

/**
 * Envia um novo comentário para uma obra.
 * Após o envio bem-sucedido, invalida o cache SWR dos comentários
 * daquela obra para refletir o novo estado imediatamente.
 *
 * @returns O comentário criado pelo servidor.
 *
 * @example
 * await postComentario({
 *   id_do_topico: '123',
 *   id_do_jogador: String(telegramUser.id),
 *   nome_do_jogador: telegramUser.first_name,
 *   comentario: 'Incrível!',
 * });
 */
export async function postComentario(
  payload: PostComentarioPayload,
): Promise<Comentario> {
  const response = await fetch(API_BASE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'postComentario', ...payload }),
  });

  if (!response.ok) {
    throw new Error(
      `[postComentario] Erro HTTP ${response.status}`,
    );
  }

  const json: ApiResponse<Comentario> = await response.json();

  if (!json.success || !json.data) {
    throw new Error(
      `[postComentario] Falha: ${json.error ?? 'Resposta inválida'}`,
    );
  }

  return json.data;
}

/**
 * Faz upload de um arquivo de mídia para a API GAS em Base64.
 *
 * O Apps Script recebe o Base64, decodifica e salva no Google Drive /
 * envia ao Telegram, retornando o telegram_file_id.
 *
 * @example
 * // Converta o File para Base64 antes:
 * const base64 = await fileToBase64(file);
 * const result = await uploadMidia({
 *   nome_arquivo: file.name,
 *   mime_type: file.type,
 *   base64,
 *   id_do_topico: '123',
 * });
 * console.log(result.telegram_file_id);
 */
export async function uploadMidia(
  payload: UploadMidiaPayload,
): Promise<UploadMidiaResponse> {
  const response = await fetch(API_BASE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'uploadMidia', ...payload }),
  });

  if (!response.ok) {
    throw new Error(`[uploadMidia] Erro HTTP ${response.status}`);
  }

  const json: ApiResponse<UploadMidiaResponse> = await response.json();

  if (!json.success || !json.data) {
    throw new Error(
      `[uploadMidia] Falha: ${json.error ?? 'Resposta inválida'}`,
    );
  }

  return json.data;
}

// ============================================================
// Utilitário: converte File → Base64
// ============================================================

/**
 * Converte um objeto `File` (ou `Blob`) em string Base64 pura
 * (sem o prefixo `data:mime/type;base64,`).
 *
 * @example
 * const base64 = await fileToBase64(event.target.files[0]);
 */
export function fileToBase64(file: File | Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Remove o prefixo "data:*;base64," para enviar apenas o conteúdo
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

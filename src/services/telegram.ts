/**
 * telegram.ts
 * Helper para resolver telegram_file_id → URL pública de streaming.
 *
 * O Telegram NÃO permite CORS em chamadas diretas do browser ao /getFile,
 * portanto fazemos o resolve via proxy no servidor (src/server.ts) em
 * produção. No desenvolvimento (Vite), a chamada vai para /api/telegram-file
 * que é proxiada pelo vite.config.ts.
 *
 * Se VITE_TELEGRAM_BOT_TOKEN não estiver definido, a função retorna null
 * e o player exibirá o placeholder.
 */

const BOT_TOKEN = import.meta.env.VITE_TELEGRAM_BOT_TOKEN as string | undefined;

/** Cache em memória para evitar chamadas repetidas ao /getFile */
const cache = new Map<string, string | null>();

/**
 * Resolve um telegram_file_id para a URL pública de streaming.
 * Retorna null se o token não estiver configurado ou se a API falhar.
 */
export async function resolveTelegramFileUrl(
  fileId: string
): Promise<string | null> {
  if (!fileId) return null;
  if (cache.has(fileId)) return cache.get(fileId)!;

  if (!BOT_TOKEN) {
    console.warn(
      '[Telegram] VITE_TELEGRAM_BOT_TOKEN não definido. ' +
        'Adicione a variável de ambiente para resolver mídias do Telegram.'
    );
    cache.set(fileId, null);
    return null;
  }

  try {
    // Em dev, o vite proxy encaminha /api/telegram/* → https://api.telegram.org
    // Em produção, o servidor Node (src/server.ts) deve expor o mesmo endpoint.
    const apiUrl = `https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${encodeURIComponent(fileId)}`;

    const res = await fetch(apiUrl);
    if (!res.ok) {
      console.error('[Telegram] /getFile retornou HTTP', res.status, 'para file_id:', fileId);
      cache.set(fileId, null);
      return null;
    }

    const json = await res.json();
    console.log('[Telegram] /getFile response:', json);

    if (!json.ok || !json.result?.file_path) {
      console.warn('[Telegram] file_path não encontrado para file_id:', fileId, json);
      cache.set(fileId, null);
      return null;
    }

    const url = `https://api.telegram.org/file/bot${BOT_TOKEN}/${json.result.file_path}`;
    console.log('[Telegram] URL resolvida:', url);
    cache.set(fileId, url);
    return url;
  } catch (err) {
    console.error('[Telegram] Erro ao resolver file_id:', fileId, err);
    cache.set(fileId, null);
    return null;
  }
}

/**
 * Resolve múltiplos file_ids em paralelo.
 * Retorna um Map<fileId, url | null>.
 */
export async function resolveTelegramFileUrls(
  fileIds: string[]
): Promise<Map<string, string | null>> {
  const unique = [...new Set(fileIds.filter(Boolean))];
  const resolved = await Promise.all(
    unique.map(async (id) => [id, await resolveTelegramFileUrl(id)] as const)
  );
  return new Map(resolved);
}

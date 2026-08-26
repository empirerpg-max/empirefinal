// Cache curto, em memória (por isolate do Worker — não é global entre
// instâncias, mas isolates costumam ficar "quentes" por várias requisições
// seguidas, então já ajuda bastante). Criado especificamente pras leituras
// mais pesadas e mais repetidas do Catálogo > Início (Top Playlists +
// fotos de artista), depois de confirmar via log real (logsSistema!LOGS)
// que elas estavam batendo no limite de requisições por minuto da API do
// Google Sheets — cada carregamento de tela relia nesses MESMOS dados de
// novo, então cachear por alguns minutos reduz bastante o volume de
// chamadas sem impacto perceptível (não é dado que muda a cada segundo).
//
// Além de economizar chamadas, serve de rede de segurança: se uma leitura
// falhar (limite de API, engasgo passageiro), devolve o último dado bom já
// visto em vez de vir vazio — antes disso, um erro assim fazia a tela
// inteira cair pra "sem foto"/"capa padrão" mesmo com dado bom disponível
// de minutos atrás.
interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const CACHE = new Map<string, CacheEntry<unknown>>();

export async function cachedRead<T>(key: string, ttlMs: number, fetcher: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const cached = CACHE.get(key) as CacheEntry<T> | undefined;
  if (cached && cached.expiresAt > now) return cached.value;

  try {
    const value = await fetcher();
    CACHE.set(key, { value, expiresAt: now + ttlMs });
    return value;
  } catch (err) {
    if (cached) {
      console.warn(`[shortCache] Falha ao atualizar "${key}", servindo último dado bom em cache:`, err);
      return cached.value;
    }
    throw err;
  }
}

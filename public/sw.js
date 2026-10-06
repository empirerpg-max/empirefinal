const CACHE = "empire-shell-v2";
// "/" não entra mais aqui — navegação nunca serve HTML cacheado (ver
// comentário no listener de "fetch"), então pré-cachear a home só ocuparia
// espaço à toa.
const SHELL = ["/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

// Fica esperando em "waiting" até o app mandar esse sinal (usuário clicou em
// "Atualizar" no aviso de nova versão) — só então assume, em vez de trocar
// os assets debaixo do usuário no meio de uma sessão em uso.
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

// BUG CONFIRMADO em 2026-10-06 (incidente ao vivo): um fetch() dentro do
// Service Worker que nunca resolve NEM rejeita (ex: engasgo de rede, worker
// em estado inconsistente após várias atualizações seguidas) deixa
// event.respondWith() esperando pra sempre — a tela trava em "Carregando..."
// permanentemente, pra sempre, até o usuário saber (sem orientação nenhuma
// na hora) que precisa desregistrar o Service Worker manualmente. Nenhum
// fetch interceptado aqui pode ficar sem resposta — todo um corre contra um
// timeout, e quando estoura, cai pro fetch "cru" (sem passar pelo SW) como
// último recurso antes de deixar o erro real aparecer.
const FETCH_TIMEOUT_MS = 10000;

function fetchComTimeout(request) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("sw_fetch_timeout")), FETCH_TIMEOUT_MS);
    fetch(request).then(
      (res) => {
        clearTimeout(timer);
        resolve(res);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    // Esse app faz SSR por rota (HTML diferente pra cada URL) — NUNCA cair
    // pro HTML cacheado de "/" quando outra rota falha ao buscar. Fazer
    // isso mostra a Home por baixo do capô pra qualquer outra tela sempre
    // que a rede engasgar (comum logo no "cold start" de um PWA recém
    // instalado no iOS), parecendo que "só o Início funciona". Uma
    // tentativa de retry cobre esse soluço passageiro; se seguir falhando,
    // deixa o erro de rede real aparecer — nunca substitui pelo conteúdo
    // errado.
    event.respondWith(
      fetchComTimeout(request).catch(() => fetchComTimeout(request))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ||
        fetchComTimeout(request).then((res) => {
          if (res.ok && (request.destination === "style" || request.destination === "script" || request.destination === "image")) {
            const clone = res.clone();
            caches.open(CACHE).then((cache) => cache.put(request, clone));
          }
          return res;
        })
    )
  );
});

const CACHE = "empire-shell-v1";
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
      fetch(request).catch(() => fetch(request))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ||
        fetch(request).then((res) => {
          if (res.ok && (request.destination === "style" || request.destination === "script" || request.destination === "image")) {
            const clone = res.clone();
            caches.open(CACHE).then((cache) => cache.put(request, clone));
          }
          return res;
        })
    )
  );
});

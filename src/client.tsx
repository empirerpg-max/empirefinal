import { StrictMode, startTransition } from "react";
import { hydrateRoot } from "react-dom/client";
import { StartClient } from "@tanstack/react-start/client";

// Depois de um deploy novo, um chunk lazy (rota carregada sob demanda, ex:
// Catálogo, Ponto) pode ter o nome do arquivo trocado — se a aba já estava
// aberta com o index.html antigo, o import dinâmico desse chunk falha
// ("Importing a module script failed" / vite:preloadError) e a tela de erro
// aparece sem motivo aparente pro usuário. Em vez de mostrar erro, recarrega
// a página 1x (pegando tudo fresco) — sessionStorage evita loop se a causa
// for outra (ex: sem rede de verdade).
function reloadOnStaleChunk() {
  const FLAG = "empire_stale_chunk_reload";
  const alreadyTried = sessionStorage.getItem(FLAG);
  if (alreadyTried && Date.now() - Number(alreadyTried) < 10_000) return;
  sessionStorage.setItem(FLAG, String(Date.now()));
  window.location.reload();
}

window.addEventListener("vite:preloadError", reloadOnStaleChunk);
window.addEventListener("error", (event) => {
  if (/importing a module script failed|dynamically imported module/i.test(event.message || "")) {
    reloadOnStaleChunk();
  }
});
window.addEventListener("unhandledrejection", (event) => {
  const msg = event.reason?.message || String(event.reason || "");
  if (/importing a module script failed|dynamically imported module|failed to fetch dynamically/i.test(msg)) {
    reloadOnStaleChunk();
  }
});

startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <StartClient />
    </StrictMode>,
  );
});

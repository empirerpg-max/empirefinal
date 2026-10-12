import { StrictMode, startTransition } from "react";
import { hydrateRoot } from "react-dom/client";
import { StartClient } from "@tanstack/react-start/client";
import { toast } from "sonner";
import {
  isStaleChunkErrorMessage,
  pareceFalhaDeChunkJs,
  reloadOnStaleChunk as reloadOnStaleChunkShared,
} from "@/lib/staleChunk";

// Depois de um deploy novo, um chunk lazy (rota carregada sob demanda, ex:
// Catálogo, Ponto) pode ter o nome do arquivo trocado — se a aba já estava
// aberta com o index.html antigo, o import dinâmico desse chunk falha
// ("Importing a module script failed" / vite:preloadError) e a tela de erro
// aparece sem motivo aparente pro usuário. Em vez de mostrar erro, recarrega
// a página 1x (pegando tudo fresco) — sessionStorage evita loop se a causa
// for outra (ex: sem rede de verdade).
//
// Esse gatilho é global e silencioso — dispara de qualquer import que falhe
// em background, mesmo sem o usuário ter feito nada. Sem a proteção abaixo,
// já aconteceu de recarregar em cima de alguém digitando um comentário
// grande (caso do Gilson no álbum SANTISSIMA, que perdeu o texto todo no
// meio de um deploy) — nunca recarrega com um campo de texto ativo e com
// conteúdo; espera a pessoa sair do campo pra aplicar.
//
// estaDigitando/avisoPendenteMostrado/a lógica de reload em si viraram
// src/lib/staleChunk.ts — compartilhadas com router.tsx (defaultOnCatch),
// que precisa do MESMO reparo pra um caminho de falha que esses listeners
// globais aqui não cobrem (ver comentário em staleChunk.ts).
function reloadOnStaleChunk() {
  reloadOnStaleChunkShared(toast);
}

window.addEventListener("vite:preloadError", reloadOnStaleChunk);
window.addEventListener("error", (event) => {
  const msg = event.message || "";
  if (isStaleChunkErrorMessage(msg)) {
    reloadOnStaleChunk();
    return;
  }
  if (/^load failed$/i.test(msg) && pareceFalhaDeChunkJs(event.error?.stack)) {
    reloadOnStaleChunk();
  }
});
window.addEventListener("unhandledrejection", (event) => {
  const msg = event.reason?.message || String(event.reason || "");
  if (isStaleChunkErrorMessage(msg)) {
    reloadOnStaleChunk();
    return;
  }
  if (/^load failed$/i.test(msg) && pareceFalhaDeChunkJs(event.reason?.stack)) {
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

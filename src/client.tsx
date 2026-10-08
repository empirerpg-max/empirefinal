import { StrictMode, startTransition } from "react";
import { hydrateRoot } from "react-dom/client";
import { StartClient } from "@tanstack/react-start/client";
import { toast } from "sonner";

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
function estaDigitando(): HTMLElement | null {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return null;
  if (el.tagName === "TEXTAREA") {
    return (el as HTMLTextAreaElement).value.trim() ? el : null;
  }
  if (el.tagName === "INPUT") {
    const tipo = (el as HTMLInputElement).type;
    if (["text", "search", "email", "tel", "url", ""].includes(tipo)) {
      return (el as HTMLInputElement).value.trim() ? el : null;
    }
    return null;
  }
  if (el.isContentEditable) {
    return el.textContent?.trim() ? el : null;
  }
  return null;
}

let avisoPendenteMostrado = false;

function reloadOnStaleChunk() {
  const FLAG = "empire_stale_chunk_reload";
  const alreadyTried = sessionStorage.getItem(FLAG);
  if (alreadyTried && Date.now() - Number(alreadyTried) < 10_000) return;

  const campoAtivo = estaDigitando();
  if (campoAtivo) {
    if (!avisoPendenteMostrado) {
      avisoPendenteMostrado = true;
      toast("Nova versão pronta", {
        description: "Vamos atualizar assim que você terminar de escrever, pra não perder o que já digitou.",
        duration: 8000,
      });
    }
    campoAtivo.addEventListener(
      "blur",
      () => {
        avisoPendenteMostrado = false;
        reloadOnStaleChunk();
      },
      { once: true },
    );
    return;
  }

  sessionStorage.setItem(FLAG, String(Date.now()));
  window.location.reload();
}

// "Load failed" é a mensagem GENÉRICA do WebKit (Safari/iOS — inclusive a
// WebView do Telegram Mini App em iPhone) pra QUALQUER fetch() que falhe,
// não só import de chunk JS — uma chamada de API comum engasgando na rede
// 4G do celular lança o mesmo texto que um chunk desatualizado. Sem
// distinguir os dois, o app recarregava do nada em qualquer soluço de rede
// no mobile (confirmado em reclamações reais de usuário: "o app atualiza
// do nada às vezes"). Only os erros de "Importing a module script
// failed"/"dynamically imported module" já são específicos o bastante
// (só acontecem em import() de verdade); pro "Load failed" genérico, exige
// que o stack trace realmente referencie um chunk JS do nosso build
// (sempre servido de "/assets/...js") antes de recarregar — uma falha de
// fetch comum da API (ex: /api/...) nunca aparece no stack apontando pra
// um asset.
function pareceFalhaDeChunkJs(stack: string | undefined): boolean {
  return /\/assets\/[^"'\s)]+\.js/i.test(stack || "");
}

window.addEventListener("vite:preloadError", reloadOnStaleChunk);
window.addEventListener("error", (event) => {
  const msg = event.message || "";
  if (/importing a module script failed|dynamically imported module/i.test(msg)) {
    reloadOnStaleChunk();
    return;
  }
  if (/^load failed$/i.test(msg) && pareceFalhaDeChunkJs(event.error?.stack)) {
    reloadOnStaleChunk();
  }
});
window.addEventListener("unhandledrejection", (event) => {
  const msg = event.reason?.message || String(event.reason || "");
  if (/importing a module script failed|dynamically imported module|failed to fetch dynamically/i.test(msg)) {
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

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

window.addEventListener("vite:preloadError", reloadOnStaleChunk);
window.addEventListener("error", (event) => {
  // "Load failed" é a mensagem genérica do WebKit (Safari/iOS — inclusive
  // a WebView do Telegram Mini App em iPhone) pra fetch/import que falhou;
  // sem isso, só o Chrome ("Importing a module script failed"/"dynamically
  // imported module") se recuperava sozinho, e usuários de iPhone ficavam
  // com a tela quebrada (parecendo "sumiram meus dados") até fechar e abrir
  // o app de novo manualmente.
  if (/importing a module script failed|dynamically imported module|^load failed$/i.test(event.message || "")) {
    reloadOnStaleChunk();
  }
});
window.addEventListener("unhandledrejection", (event) => {
  const msg = event.reason?.message || String(event.reason || "");
  if (/importing a module script failed|dynamically imported module|failed to fetch dynamically|^load failed$/i.test(msg)) {
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

// Detecção + reparo de "chunk desatualizado" — depois de um deploy novo, um
// chunk lazy (rota carregada sob demanda, ex: Catálogo > Gestão Pre save)
// pode ter o nome do arquivo trocado; se a aba já estava aberta com o
// index.html antigo, o import dinâmico desse chunk falha ("Importing a
// module script failed" / "dynamically imported module") e a tela quebra
// sem motivo aparente pro usuário.
//
// Compartilhado entre dois pontos de entrada diferentes:
// - client.tsx: escuta os eventos GLOBAIS (window "error"/"unhandledrejection"
//   /"vite:preloadError") — cobre falhas de import que escapam pro nível do
//   browser.
// - router.tsx (defaultOnCatch): o TanStack Router, ao carregar um chunk de
//   rota sob demanda (code-splitting automático por rota), captura a
//   rejeição da promise INTERNAMENTE e entrega pro error boundary
//   (RouteErrorScreen) — essa rejeição NUNCA chega a virar um evento global
//   "unhandledrejection" (o router já tratou/capturou), então os listeners
//   de client.tsx nunca disparavam nesse caminho. Bug real confirmado em
//   produção: jogador tentando abrir a tela de completar missão do
//   pre-save (rota carregada sob demanda, reconstruída várias vezes ao
//   longo do dia) caía direto na tela "Algo deu errado" em vez de
//   recarregar sozinho — exatamente esse gap.
export function isStaleChunkErrorMessage(message: string | undefined | null): boolean {
  return /importing a module script failed|dynamically imported module|failed to fetch dynamically/i.test(
    message || "",
  );
}

// "Load failed" é a mensagem GENÉRICA do WebKit (Safari/iOS, inclusive a
// WebView do Telegram Mini App) pra QUALQUER fetch() que falhe, não só
// import de chunk JS — por isso só conta quando o stack referencia de
// verdade um asset JS do nosso build (sempre servido de "/assets/...js").
export function pareceFalhaDeChunkJs(stack: string | undefined | null): boolean {
  return /\/assets\/[^"'\s)]+\.js/i.test(stack || "");
}

function estaDigitando(): HTMLElement | null {
  if (typeof document === "undefined") return null;
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

// Recarrega a página 1x (sessionStorage evita loop) — nunca em cima de um
// campo de texto ativo com conteúdo (espera a pessoa sair do campo).
// `toastFn` é injetado pra não acoplar este util à lib de toast usada.
export function reloadOnStaleChunk(
  toastFn?: (title: string, opts?: { description?: string; duration?: number }) => void,
) {
  if (typeof window === "undefined" || typeof sessionStorage === "undefined") return;
  const FLAG = "empire_stale_chunk_reload";
  const alreadyTried = sessionStorage.getItem(FLAG);
  if (alreadyTried && Date.now() - Number(alreadyTried) < 10_000) return;

  const campoAtivo = estaDigitando();
  if (campoAtivo) {
    if (!avisoPendenteMostrado) {
      avisoPendenteMostrado = true;
      toastFn?.("Nova versão pronta", {
        description:
          "Vamos atualizar assim que você terminar de escrever, pra não perder o que já digitou.",
        duration: 8000,
      });
    }
    campoAtivo.addEventListener(
      "blur",
      () => {
        avisoPendenteMostrado = false;
        reloadOnStaleChunk(toastFn);
      },
      { once: true },
    );
    return;
  }

  sessionStorage.setItem(FLAG, String(Date.now()));
  window.location.reload();
}

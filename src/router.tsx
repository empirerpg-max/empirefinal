import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { toast } from "sonner";
import { routeTree } from "./routeTree.gen";
import { RouteErrorScreen } from "./components/RouteErrorScreen";
import { isStaleChunkErrorMessage, reloadOnStaleChunk } from "./lib/staleChunk";

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        retry: 1,
      },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreload: "intent",
    defaultPreloadStaleTime: 30_000,
    defaultPreloadDelay: 30,
    defaultErrorComponent: RouteErrorScreen,
    defaultOnCatch: (error) => {
      const message = error instanceof Error ? error.message : String(error);
      // Bug real confirmado em produção: o TanStack Router, ao carregar o
      // chunk de uma rota sob demanda (ex: a tela de completar missão do
      // pre-save), captura a rejeição da promise de import() INTERNAMENTE
      // e entrega pra este defaultOnCatch — essa rejeição nunca chega a
      // virar um evento global "unhandledrejection", então os listeners
      // de client.tsx (window.addEventListener) nunca disparavam nesse
      // caminho, e o jogador caía direto na tela "Algo deu errado" em vez
      // do app recarregar sozinho (ver staleChunk.ts pro detalhe completo).
      // Chama a MESMA lógica de recarregar aqui também.
      if (isStaleChunkErrorMessage(message)) {
        reloadOnStaleChunk(toast);
      }
      // A caixinha padrão do router esconde a mensagem atrás de um botão
      // pequeno demais pra tocar no celular — manda pro mesmo log que já
      // existe (KV "error-log") pra dar pra diagnosticar sem depender de
      // ninguém conseguir clicar em nada na tela quebrada.
      try {
        fetch("/api/log-error", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message,
            stack: error instanceof Error ? error.stack : undefined,
            path: typeof location !== "undefined" ? location.pathname : undefined,
          }),
          keepalive: true,
        }).catch(() => {});
      } catch {
        // Nunca deixa a tentativa de logar o erro gerar outro erro.
      }
    },
  });

  return router;
};

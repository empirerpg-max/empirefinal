import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { RouteErrorScreen } from "./components/RouteErrorScreen";

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
      // A caixinha padrão do router esconde a mensagem atrás de um botão
      // pequeno demais pra tocar no celular — manda pro mesmo log que já
      // existe (KV "error-log") pra dar pra diagnosticar sem depender de
      // ninguém conseguir clicar em nada na tela quebrada.
      try {
        fetch("/api/log-error", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            path: typeof location !== "undefined" ? location.pathname : undefined,
          }),
          keepalive: true,
        }).catch(() => {});
      } catch {}
    },
  });

  return router;
};

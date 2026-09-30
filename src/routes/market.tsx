import { createFileRoute, Outlet } from "@tanstack/react-router";

// "/market" tem rotas filhas (ex: "/market/regras") — essa casca só
// desenha o <Outlet/> que decide qual delas mostrar. O conteúdo da
// própria tela do Market (produtos, saldo etc.) mora em market.index.tsx.
// Sem esse <Outlet/>, navegar pra qualquer filha (ex: clicar em "Entenda
// os prestígios") só re-renderizava a tela do Market de novo, porque o
// roteador nunca tinha onde desenhar a página filha.
export const Route = createFileRoute("/market")({
  component: () => <Outlet />,
});

import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/empire-play/gestao")({
  component: () => <Outlet />,
});

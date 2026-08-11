import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/empire-play/albuns-antigos")({
  component: () => <Outlet />,
});

import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/ponto/playlists")({
  component: () => <Outlet />,
});

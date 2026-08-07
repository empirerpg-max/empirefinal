import { createFileRoute } from "@tanstack/react-router";
import { PlaylistEditor } from "@/components/PlaylistEditor";

export const Route = createFileRoute("/playlists/nova")({ component: () => <PlaylistEditor /> });

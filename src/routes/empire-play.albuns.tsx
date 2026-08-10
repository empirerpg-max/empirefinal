import { createFileRoute } from "@tanstack/react-router";
import { AlbumList } from "@/components/EmpirePlay/AlbumList";

export const Route = createFileRoute("/empire-play/albuns")({
  component: EmpirePlayAlbuns,
});

function EmpirePlayAlbuns() {
  return <AlbumList />;
}

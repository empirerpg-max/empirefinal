import { createFileRoute } from "@tanstack/react-router";
import { EmpirePlayMenu } from "@/components/EmpirePlay/EmpirePlayMenu";

export const Route = createFileRoute("/empire-play")({
  head: () => ({
    meta: [
      { title: "Empire Play — Empire Hub" },
      { name: "description", content: "Músicas, vídeos, álbuns e o fórum do Empire Play." },
    ],
  }),
  component: EmpirePlayPage,
});

function EmpirePlayPage() {
  return <EmpirePlayMenu />;
}

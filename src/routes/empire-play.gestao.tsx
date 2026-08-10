import { createFileRoute } from "@tanstack/react-router";
import { Gestao } from "@/components/EmpirePlay/Gestao";

export const Route = createFileRoute("/empire-play/gestao")({
  component: EmpirePlayGestao,
});

function EmpirePlayGestao() {
  return <Gestao />;
}

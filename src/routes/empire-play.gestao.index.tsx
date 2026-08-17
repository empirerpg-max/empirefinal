import { createFileRoute } from "@tanstack/react-router";
import { Gestao, type TabType } from "@/components/EmpirePlay/Gestao";

export const Route = createFileRoute("/empire-play/gestao/")({
  validateSearch: (s: Record<string, unknown>): { tab?: TabType; nome?: string } => ({
    tab: s.tab === "musica" || s.tab === "video" || s.tab === "album" ? s.tab : undefined,
    nome: s.nome ? String(s.nome) : undefined,
  }),
  component: EmpirePlayGestao,
});

function EmpirePlayGestao() {
  const { tab, nome } = Route.useSearch();
  return <Gestao initialTab={tab} initialArtista={nome} />;
}

import { createFileRoute } from "@tanstack/react-router";
import { PreSavePublicPage } from "@/components/EmpirePlay/PreSavePublicPage";

// Página pública de acompanhamento de uma campanha de pre-save — acessível
// a QUALQUER jogador (não só o criador), link de destino do banner da Home
// e de qualquer card de campanha ativa. Mostra contagem regressiva,
// tracklist (nome real ou "Track N" conforme a escolha do criador) e o
// contador de pre-save ao vivo — NUNCA o teto. Comentários do tópico
// ficam travados pra postar até o lançamento (ver getPreSaveLockParaTopico,
// preSaveController.ts) — antes do dia D simplesmente não existem ainda.
export const Route = createFileRoute("/empire-play/presave/$id")({
  component: PreSaveRouteComponent,
});

function PreSaveRouteComponent() {
  const { id } = Route.useParams();
  return <PreSavePublicPage campanhaId={id} />;
}

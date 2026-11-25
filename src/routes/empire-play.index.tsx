import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { PlaylistsInicio } from "@/components/EmpirePlay/PlaylistsInicio";
import { TelaPlaylist } from "@/components/EmpirePlay/TelaPlaylist";

export const Route = createFileRoute("/empire-play/")({
  component: EmpirePlayInicio,
});

function EmpirePlayInicio() {
  // Tela cheia de playlist: abre por id ("ao-vivo:spotify",
  // "pais:apple:BRASIL", "semana:hot"...). A Início mostra só o destaque e
  // as prateleiras; a lista só abre depois do clique.
  const [activeSlidingPlaylist, setActiveSlidingPlaylist] = useState<string | null>(null);

  // O botão de voltar do Telegram/gesto do Android navega pelo HISTÓRICO do
  // navegador, não sabe nada do estado local dessa tela — sem empurrar uma
  // entrada de histórico quando a tela deslizante abre, voltar não fecha
  // ela (o gesto "vaza" pra rota de trás, deixando a tela presa). Empurra
  // uma entrada marcada ao abrir; ao voltar (gesto, botão do Telegram ou
  // botão físico do Android), o popstate fecha a tela em vez de navegar.
  useEffect(() => {
    if (!activeSlidingPlaylist) return;
    window.history.pushState({ empireSlidingPlaylist: true }, "");
    // Só fecha a playlist quando o voltar saiu da entrada dela; voltar de uma
    // tela aberta por cima (ex.: um clipe) cai de novo na entrada da playlist
    // e deve manter a playlist aberta (regra do app: voltar = tela anterior).
    const onPopState = () => {
      if (!window.history.state?.empireSlidingPlaylist) setActiveSlidingPlaylist(null);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [activeSlidingPlaylist]);

  // Fechar pelo X/seta também passa pelo histórico — se não fizer isso, a
  // entrada empurrada acima fica "órfã" e o próximo voltar do usuário não
  // faz nada (o SPA nunca navegou de verdade, só o estado local mudou).
  const closeSlidingPlaylist = () => {
    if (window.history.state?.empireSlidingPlaylist) {
      window.history.back();
    } else {
      setActiveSlidingPlaylist(null);
    }
  };

  const abrirPlaylist = (id: string) => setActiveSlidingPlaylist(id);

  return (
    <div className="space-y-6">
      <PlaylistsInicio onAbrir={abrirPlaylist} pausado={!!activeSlidingPlaylist} />

      {activeSlidingPlaylist &&
        typeof document !== "undefined" &&
        createPortal(
          <TelaPlaylist id={activeSlidingPlaylist} onFechar={closeSlidingPlaylist} />,
          document.body,
        )}
    </div>
  );
}

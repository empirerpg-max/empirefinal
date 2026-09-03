import { useRef } from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { X, Maximize2, Radio } from "lucide-react";
import { useTvPlayer } from "./TvPlayerContext";
import { resolveStreamEmbed } from "@/lib/tvEmbed";

/**
 * Miniatura flutuante da transmissão, montada na raiz do app (fora da rota
 * /tv) — só some quando `watching` é null. Aparece toda vez que a pessoa
 * está numa transmissão e sai da tela cheia da Empire TV (troca de aba do
 * app, ou minimiza manualmente), sem cortar o vídeo.
 */
export function TvMiniPlayer() {
  const { watching, floating, restore, close } = useTvPlayer();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  // Enquanto a própria rota /tv está mostrando a tela cheia, o player dela
  // já cobre o caso — não duplica aqui.
  const onTvRoute = pathname === "/tv";
  if (!watching || (onTvRoute && !floating)) return null;

  const embed = resolveStreamEmbed(watching.stream_url, !!watching.ao_vivo);

  const handleExpand = () => {
    restore();
    if (!onTvRoute) navigate({ to: "/tv" });
  };

  return (
    <div
      className="fixed z-[110] bottom-24 right-3 w-40 sm:w-52 rounded-xl overflow-hidden bg-black shadow-[0_10px_30px_rgba(0,0,0,0.6)] border border-white/15 animate-in slide-in-from-bottom-5 fade-in duration-300"
      role="dialog"
      aria-label={`Transmissão flutuante: ${watching.titulo}`}
    >
      <button
        type="button"
        onClick={handleExpand}
        className="block w-full aspect-video bg-neutral-900 relative"
        aria-label="Expandir transmissão"
      >
        {embed ? (
          <iframe
            ref={iframeRef}
            src={embed}
            title={watching.titulo}
            className="w-full h-full border-0 pointer-events-none"
            allow="autoplay; encrypted-media; picture-in-picture"
          />
        ) : (
          <div className="w-full h-full grid place-items-center text-[10px] text-neutral-500">Sem vídeo</div>
        )}
        <div className="absolute inset-0 flex items-end justify-center pb-1 opacity-0 hover:opacity-100 transition bg-black/30">
          <Maximize2 className="size-4 text-white" />
        </div>
      </button>

      <div className="flex items-center gap-1.5 px-2 h-8 bg-neutral-950">
        {watching.ao_vivo && (
          <span className="flex items-center gap-1 px-1 py-0.5 rounded bg-red-500 text-white text-[9px] font-bold shrink-0">
            <Radio className="size-2 animate-pulse" /> LIVE
          </span>
        )}
        <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-white">{watching.titulo}</span>
        <button
          type="button"
          onClick={close}
          className="size-6 shrink-0 rounded-full hover:bg-white/10 grid place-items-center text-neutral-400 hover:text-white"
          aria-label="Fechar transmissão"
        >
          <X className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

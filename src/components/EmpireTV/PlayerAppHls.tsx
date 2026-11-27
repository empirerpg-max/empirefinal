import { useEffect, useRef, useState } from "react";
import { Maximize, Volume2, VolumeX } from "lucide-react";
import { hasUnmutedThisSession, markUnmutedThisSession } from "@/lib/tvEmbed";

/**
 * Player PRÓPRIO da Empire TV: toca o vídeo HLS que a Kick já transmite
 * (o `playback_url` que o app recebe na checagem de "ao vivo" a cada 12 s),
 * num <video> do próprio app. Assim o botão de som é nosso e um toque nele
 * basta para liberar o áudio — coisa que o player embutido da Kick não deixa
 * (o navegador só aceita o toque DENTRO do player de outro domínio).
 *
 * Não é recurso oficial da Kick: qualquer erro sem conserto chama `onFalha`
 * e a sala volta sozinha para o player da Kick. Antes de desistir tenta
 * consertar (rede: até 3 recomeços; mídia: recuperação do hls.js; vídeo
 * parado: recarrega uma vez com o link mais novo).
 *
 * `src` pode mudar a cada checagem (token novo): o player NÃO recarrega por
 * isso — só usa o link mais novo quando precisa recomeçar.
 */
export function PlayerAppHls({
  src,
  titulo,
  onFalha,
  compacto = false,
  acoes,
}: {
  src: string;
  titulo: string;
  onFalha: (motivo: string) => void;
  /** Mini player: sem botões, sem interação. */
  compacto?: boolean;
  /** Botões extras ao lado do som (ex.: trocar para o player da Kick). */
  acoes?: React.ReactNode;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const caixaRef = useRef<HTMLDivElement>(null);
  const srcRef = useRef(src);
  srcRef.current = src;
  const onFalhaRef = useRef(onFalha);
  onFalhaRef.current = onFalha;
  const [mudo, setMudo] = useState(true);
  const [tocando, setTocando] = useState(false);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    let vivo = true;
    let hls: import("hls.js").default | null = null;
    let recomecosRede = 0;
    let recuperouMidia = false;
    let recarregou = false;
    let vigia: ReturnType<typeof setInterval> | null = null;
    let ultimoTempo = -1;
    let paradoDesde = 0;

    const falhar = (motivo: string) => {
      if (!vivo) return;
      vivo = false;
      onFalhaRef.current(motivo);
    };

    // Toca com som se a pessoa já liberou o som nesta sessão; se o navegador
    // barrar, toca mudo (o botão de som resolve com um toque).
    const tocar = async () => {
      v.muted = !hasUnmutedThisSession();
      try {
        await v.play();
      } catch {
        if (!vivo) return;
        v.muted = true;
        try {
          await v.play();
        } catch {
          falhar("o navegador não deixou o vídeo começar");
          return;
        }
      }
      if (!vivo) return;
      setMudo(v.muted);
      setTocando(true);
    };

    const carregar = async (link: string) => {
      const { default: Hls } = await import("hls.js");
      if (!vivo) return;
      if (Hls.isSupported()) {
        hls?.destroy();
        hls = new Hls({
          lowLatencyMode: true,
          // Qualidade até o tamanho do player na tela: no celular não baixa
          // 1080p à toa (menos internet e menos memória).
          capLevelToPlayerSize: true,
          maxBufferLength: 20,
          backBufferLength: 10,
        });
        hls.on(Hls.Events.ERROR, (_e, d) => {
          if (!d.fatal || !hls) return;
          if (d.type === Hls.ErrorTypes.NETWORK_ERROR && recomecosRede < 3) {
            recomecosRede++;
            setTimeout(() => vivo && hls?.startLoad(), 1_500 * recomecosRede);
            return;
          }
          if (d.type === Hls.ErrorTypes.MEDIA_ERROR && !recuperouMidia) {
            recuperouMidia = true;
            hls.recoverMediaError();
            return;
          }
          falhar(`erro do vídeo (${d.details})`);
        });
        hls.on(Hls.Events.MANIFEST_PARSED, () => void tocar());
        hls.loadSource(link);
        hls.attachMedia(v);
      } else if (v.canPlayType("application/vnd.apple.mpegurl")) {
        v.src = link;
        v.load();
        void tocar();
      } else {
        falhar("este navegador não toca o player do app");
      }
    };

    const onErroNativo = () => {
      if (!hls) falhar("erro do vídeo");
    };
    v.addEventListener("error", onErroNativo);

    // Vídeo parado por 25 s (sem pausa da pessoa): recarrega uma vez com o
    // link mais novo; se parar de novo, volta para a Kick.
    vigia = setInterval(() => {
      if (!vivo || v.paused) {
        paradoDesde = 0;
        return;
      }
      if (v.currentTime !== ultimoTempo) {
        ultimoTempo = v.currentTime;
        paradoDesde = 0;
        return;
      }
      if (!paradoDesde) paradoDesde = Date.now();
      else if (Date.now() - paradoDesde > 25_000) {
        paradoDesde = 0;
        if (recarregou) {
          falhar("o vídeo parou");
        } else {
          recarregou = true;
          recomecosRede = 0;
          recuperouMidia = false;
          void carregar(srcRef.current);
        }
      }
    }, 5_000);

    // Fora do ar por muito tempo antes de começar: desiste e volta para a Kick.
    const prazoInicio = setTimeout(() => {
      if (vivo && v.readyState < 2) falhar("o vídeo não começou");
    }, 20_000);

    void carregar(srcRef.current);

    return () => {
      vivo = false;
      clearTimeout(prazoInicio);
      if (vigia) clearInterval(vigia);
      v.removeEventListener("error", onErroNativo);
      hls?.destroy();
      v.removeAttribute("src");
      v.load();
    };
    // Recria só ao trocar de modo (cheio/mini). Link novo não recarrega.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compacto]);

  // Toque no NOSSO botão: é ele que o navegador aceita para liberar o som.
  const alternarSom = () => {
    const v = videoRef.current;
    if (!v) return;
    const ligar = v.muted;
    v.muted = !ligar;
    if (ligar) {
      v.volume = 1;
      markUnmutedThisSession();
      void v.play().catch(() => {});
    }
    setMudo(v.muted);
  };

  // Tela cheia (o player da Kick tinha; não pode faltar). iPhone só deixa o
  // próprio <video> ir para a tela cheia.
  const telaCheia = () => {
    const v = videoRef.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
    const caixa = caixaRef.current;
    if (!v || !caixa) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
    } else if (caixa.requestFullscreen) {
      void caixa.requestFullscreen().catch(() => v.webkitEnterFullscreen?.());
    } else {
      v.webkitEnterFullscreen?.();
    }
  };

  return (
    <div ref={caixaRef} className="relative w-full h-full bg-black">
      <video
        ref={videoRef}
        className={`w-full h-full block ${compacto ? "pointer-events-none" : ""}`}
        playsInline
        muted
        aria-label={titulo}
      />
      {!compacto && (
        // Canto de cima, como o botão de som de antes (o topo esquerdo é
        // dos botões voltar/minimizar/LIVE).
        <div className="absolute top-2 right-2 z-10 flex items-center gap-1.5 max-w-[70%] min-w-0">
          {acoes}
          <button
            type="button"
            onClick={alternarSom}
            disabled={!tocando}
            aria-label={mudo ? "Ativar som" : "Tirar o som"}
            className={
              mudo
                ? "min-w-0 h-10 flex items-center gap-1.5 px-3 rounded-full bg-black/60 backdrop-blur text-white text-xs font-semibold shadow-lg active:scale-95 transition disabled:opacity-60"
                : "size-10 shrink-0 rounded-full bg-black/60 backdrop-blur text-white flex items-center justify-center shadow-lg active:scale-95 transition"
            }
          >
            {mudo ? (
              <>
                <VolumeX className="size-3.5 shrink-0" />
                <span className="truncate">Ativar som</span>
              </>
            ) : (
              <Volume2 className="size-4 shrink-0" />
            )}
          </button>
        </div>
      )}
      {!compacto && (
        <button
          type="button"
          onClick={telaCheia}
          aria-label="Tela cheia"
          className="absolute bottom-2 right-2 z-10 size-10 shrink-0 rounded-full bg-black/60 backdrop-blur text-white flex items-center justify-center shadow-lg active:scale-95 transition"
        >
          <Maximize className="size-4 shrink-0" />
        </button>
      )}
    </div>
  );
}

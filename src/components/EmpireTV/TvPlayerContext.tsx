import { createContext, useContext, useState, type ReactNode } from "react";
import type { ProgramaTV } from "@/lib/api";

interface TvPlayerContextValue {
  watching: ProgramaTV | null;
  /** true = tela cheia da própria rota /tv está mostrando o player; false = só o mini player flutuante (ou nada) está ativo. */
  floating: boolean;
  open: (programa: ProgramaTV) => void;
  /** Encolhe pra miniatura flutuante sem parar a transmissão — usado ao trocar de tela dentro da própria Empire TV. */
  minimize: () => void;
  /** Volta a tela cheia — usado ao tocar na miniatura flutuante. */
  restore: () => void;
  close: () => void;
  /** Refresca os dados do programa em exibição (ex.: contagem de espectadores) sem reiniciar o vídeo. */
  updateWatching: (programa: ProgramaTV) => void;
}

const TvPlayerContext = createContext<TvPlayerContextValue | null>(null);

/**
 * Mantém a transmissão tocando fora da rota /tv — sair da Empire TV pra
 * qualquer outra aba do app (Fórum, Empire Play etc.) não derruba o vídeo:
 * ele encolhe pra uma miniatura flutuante (ver TvMiniPlayer, montado na
 * raiz do app) em vez de ser desmontado.
 */
export function TvPlayerProvider({ children }: { children: ReactNode }) {
  const [watching, setWatching] = useState<ProgramaTV | null>(null);
  const [floating, setFloating] = useState(false);

  return (
    <TvPlayerContext.Provider
      value={{
        watching,
        floating,
        open: (programa) => {
          setWatching(programa);
          setFloating(false);
        },
        minimize: () => setFloating(true),
        restore: () => setFloating(false),
        close: () => {
          setWatching(null);
          setFloating(false);
        },
        updateWatching: (programa) => setWatching(programa),
      }}
    >
      {children}
    </TvPlayerContext.Provider>
  );
}

export function useTvPlayer(): TvPlayerContextValue {
  const ctx = useContext(TvPlayerContext);
  if (!ctx) {
    throw new Error("useTvPlayer deve ser usado dentro de <TvPlayerProvider>");
  }
  return ctx;
}

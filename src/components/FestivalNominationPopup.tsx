import { motion, AnimatePresence } from "motion/react";
import { useNavigate } from "@tanstack/react-router";
import { haptic } from "@/lib/telegram";

interface FestivalReminder {
  id: string;
  premiacao: string;
  capaUrl: string;
  encerramento: string;
}

interface FestivalNominationPopupProps {
  festival: FestivalReminder;
  onInscreverJa: () => void;
  onLembrarMaisTarde: () => void;
  onJaInscrevi: () => void;
}

// Popup diário (1x/dia por jogador, ver checarPopupFestival/dispensarPopupFestival)
// lembrando de inscrever o artista pros Festivais enquanto o período está
// aberto — mesmo padrão do VmaNominationPopup.
export function FestivalNominationPopup({
  festival,
  onInscreverJa,
  onLembrarMaisTarde,
  onJaInscrevi,
}: FestivalNominationPopupProps) {
  const navigate = useNavigate();

  const inscreverJa = () => {
    haptic.selection();
    onInscreverJa();
    navigate({ to: "/festivais/inscricao" });
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
        <motion.div
          initial={{ y: 20, opacity: 0, scale: 0.97 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          exit={{ y: 20, opacity: 0, scale: 0.97 }}
          className="w-full max-w-sm max-h-[92vh] bg-card border border-white/10 rounded-[2rem] shadow-2xl flex flex-col overflow-hidden"
        >
          <div className="relative w-full shrink-0 min-h-0 aspect-[2000/1704] bg-black">
            <img src={festival.capaUrl} alt={festival.premiacao} className="w-full h-full object-cover" />
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto px-6 pt-5 pb-6 flex flex-col items-center text-center gap-1.5">
            <h3 className="text-lg font-black tracking-tight">Inscrições para Festivais abertas!</h3>
            <p className="text-sm text-muted-foreground leading-snug">
              Inscreva seus artistas pra concorrer a uma vaga nos maiores festivais do ano.
            </p>
            <p className="text-xs font-bold text-primary">Até {festival.encerramento}.</p>

            <div className="w-full flex flex-col gap-2 mt-4">
              <button
                onClick={inscreverJa}
                className="w-full py-3 rounded-2xl bg-primary text-primary-foreground text-sm font-black uppercase tracking-wide active:scale-95 transition-transform"
              >
                Inscrever já
              </button>
              <button
                onClick={() => {
                  haptic.light();
                  onLembrarMaisTarde();
                }}
                className="w-full py-3 rounded-2xl border border-white/15 text-sm font-bold active:scale-95 transition-transform"
              >
                Me lembrar mais tarde
              </button>
              <button
                onClick={() => {
                  haptic.light();
                  onJaInscrevi();
                }}
                className="w-full py-2 text-xs font-semibold text-muted-foreground active:opacity-60 transition-opacity"
              >
                Já me inscrevi
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}

import { motion, AnimatePresence } from "motion/react";
import { useNavigate } from "@tanstack/react-router";
import { haptic } from "@/lib/telegram";

interface VmaAward {
  id: string;
  premiacao: string;
  capaUrl: string;
  encerramento: string;
}

interface VmaNominationPopupProps {
  award: VmaAward;
  onIndicarJa: () => void;
  onLembrarMaisTarde: () => void;
  onJaIndiquei: () => void;
}

// Popup diário (1x/dia por jogador, ver checarPopupVma/dispensarPopupVma)
// lembrando de indicar pro VMA enquanto as indicações estão abertas.
// max-h-[92vh] + layout flex em coluna com a imagem encolhendo primeiro
// (min-h-0 no container de imagem) garante que ele nunca estoura a tela em
// celulares baixos, mesmo com os 3 botões e o texto todos visíveis.
export function VmaNominationPopup({
  award,
  onIndicarJa,
  onLembrarMaisTarde,
  onJaIndiquei,
}: VmaNominationPopupProps) {
  const navigate = useNavigate();

  const indicarJa = () => {
    haptic.selection();
    onIndicarJa();
    navigate({ to: "/premiacoes/indicar" });
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
          <div className="relative w-full shrink-0 min-h-0 aspect-[1000/582] bg-black">
            <img src={award.capaUrl} alt={award.premiacao} className="w-full h-full object-cover" />
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto px-6 pt-5 pb-6 flex flex-col items-center text-center gap-1.5">
            <h3 className="text-lg font-black tracking-tight">Indicações {award.premiacao} abertas!</h3>
            <p className="text-sm text-muted-foreground leading-snug">
              Indique seus artistas e materiais favoritos e concorra à premiação mais quente do ano.
            </p>
            <p className="text-xs font-bold text-primary">Até {award.encerramento}.</p>

            <div className="w-full flex flex-col gap-2 mt-4">
              <button
                onClick={indicarJa}
                className="w-full py-3 rounded-2xl bg-primary text-primary-foreground text-sm font-black uppercase tracking-wide active:scale-95 transition-transform"
              >
                Indicar já
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
                  onJaIndiquei();
                }}
                className="w-full py-2 text-xs font-semibold text-muted-foreground active:opacity-60 transition-opacity"
              >
                Já indiquei
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}

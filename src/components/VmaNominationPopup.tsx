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
          className="w-full max-w-sm max-h-[92vh] bg-white rounded-[1.75rem] shadow-2xl flex flex-col overflow-hidden"
        >
          <div className="w-full shrink-0 min-h-0 px-8 pt-8">
            <img src={award.capaUrl} alt={award.premiacao} className="w-full h-auto object-contain" />
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto px-6 pt-2 pb-7 flex flex-col items-center text-center gap-1.5">
            <h3 className="text-lg font-black tracking-tight text-neutral-900">
              Indicações {award.premiacao} Iniciadas!
            </h3>
            <p className="text-sm text-neutral-500 leading-snug">
              Indique seus artistas e materiais favoritos e concorra à premiação mais quente do ano.
            </p>
            <p className="text-sm font-bold bg-gradient-to-r from-pink-500 to-amber-400 bg-clip-text text-transparent">
              Até {award.encerramento}.
            </p>

            <div className="w-full flex gap-3 mt-4">
              <button
                onClick={() => {
                  haptic.light();
                  onLembrarMaisTarde();
                }}
                className="flex-1 py-3 rounded-full border-2 border-pink-400 text-pink-500 text-sm font-bold active:scale-95 transition-transform"
              >
                Depois
              </button>
              <button
                onClick={indicarJa}
                className="flex-1 py-3 rounded-full bg-gradient-to-r from-pink-500 to-amber-300 text-neutral-900 text-sm font-black active:scale-95 transition-transform"
              >
                Indicar já
              </button>
            </div>

            <button
              onClick={() => {
                haptic.light();
                onJaIndiquei();
              }}
              className="mt-3 text-xs font-semibold text-neutral-400 underline underline-offset-2 active:opacity-60 transition-opacity"
            >
              Já indiquei
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}

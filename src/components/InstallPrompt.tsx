import { useEffect, useState } from "react";
import { Share, Plus, Download, X } from "lucide-react";
import { useInstallPrompt } from "@/lib/pwa";

const DISMISS_KEY = "empire_install_dismissed_v1";

export function InstallPrompt() {
  const { installed, canPromptInstall, isIOS, promptInstall } = useInstallPrompt();
  const [dismissed, setDismissed] = useState(true);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setDismissed(localStorage.getItem(DISMISS_KEY) === "1");
  }, []);

  useEffect(() => {
    if (installed || dismissed) {
      setVisible(false);
      return;
    }
    // Show after a short delay so it doesn't fight the first paint.
    const t = setTimeout(() => setVisible(canPromptInstall || isIOS), 1500);
    return () => clearTimeout(t);
  }, [installed, dismissed, canPromptInstall, isIOS]);

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, "1");
    setDismissed(true);
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div className="fixed inset-x-4 bottom-24 z-50 max-w-md mx-auto rounded-[1.75rem] border border-white/10 bg-black/90 backdrop-blur-xl shadow-2xl p-4 animate-in slide-in-from-bottom-4 fade-in duration-300">
      <button
        type="button"
        onClick={dismiss}
        aria-label="Fechar"
        className="absolute top-3 right-3 size-8 rounded-full grid place-items-center text-muted-foreground hover:text-foreground"
      >
        <X className="size-4" aria-hidden="true" />
      </button>

      <div className="flex items-start gap-3 pr-6">
        <div className="size-11 rounded-2xl bg-primary/15 border border-primary/30 grid place-items-center flex-shrink-0">
          <Download className="size-5 text-primary" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-black uppercase tracking-tight">Instale o Empire</h3>
          {isIOS && !canPromptInstall ? (
            <p className="text-[12px] text-muted-foreground font-medium leading-snug mt-1">
              Toque em <Share className="inline size-3.5 -mt-0.5" aria-hidden="true" /> Compartilhar e depois em{" "}
              <Plus className="inline size-3.5 -mt-0.5" aria-hidden="true" /> "Adicionar à Tela de Início".
            </p>
          ) : (
            <p className="text-[12px] text-muted-foreground font-medium leading-snug mt-1">
              Adicione à tela inicial para abrir como app, com acesso rápido e offline.
            </p>
          )}
        </div>
      </div>

      {!isIOS && canPromptInstall && (
        <button
          type="button"
          onClick={async () => {
            const accepted = await promptInstall();
            if (accepted) dismiss();
          }}
          className="mt-3 w-full h-11 rounded-2xl bg-primary text-black text-[12px] font-black uppercase tracking-wider active:scale-95 transition-transform"
        >
          Instalar agora
        </button>
      )}
    </div>
  );
}

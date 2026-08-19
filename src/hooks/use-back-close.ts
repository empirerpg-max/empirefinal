import { useEffect, useRef } from "react";

/**
 * Faz o botão físico/gesto de "voltar" fechar um overlay local (modal,
 * tópico selecionado, etc.) em vez de navegar pra fora da rota atual.
 *
 * Muitos overlays no app são só estado local (setSelectedTopic, isOpen...)
 * sem entrada própria no histórico do navegador — então "voltar" pula
 * direto pra rota anterior, ignorando o overlay. Isso resolve isso: ao
 * abrir, empurra uma entrada de histórico "fantasma"; ao "voltar" (popstate),
 * fecha o overlay em vez de deixar a rota mudar; ao fechar pela UI, consome
 * essa entrada de volta (history.back()) pra não acumular lixo no histórico.
 */
export function useBackClose(isOpen: boolean, onClose: () => void) {
  const pushedRef = useRef(false);
  const closingViaBackRef = useRef(false);

  useEffect(() => {
    if (!isOpen) return;

    window.history.pushState({ __backClose: true }, "");
    pushedRef.current = true;

    const onPopState = () => {
      closingViaBackRef.current = true;
      onClose();
    };
    window.addEventListener("popstate", onPopState);

    return () => {
      window.removeEventListener("popstate", onPopState);
      // Se o overlay foi fechado pela UI (botão "X", clique fora etc.) e
      // não pelo próprio "voltar", consome a entrada fantasma que empurramos
      // — senão sobra um "voltar" extra que não faz nada visível.
      if (pushedRef.current && !closingViaBackRef.current) {
        window.history.back();
      }
      pushedRef.current = false;
      closingViaBackRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);
}

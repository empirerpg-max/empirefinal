import { useEffect, useState } from "react";

export const BUILD_ID = __BUILD_ID__;

/**
 * Detecta quando uma nova versão do app foi publicada (o service worker
 * baixou um sw.js novo e ele está esperando pra assumir) e dá ao caller um
 * jeito de aplicar a atualização na hora — sem precisar que o usuário limpe
 * cache ou reinstale o PWA manualmente. Também força uma checagem sempre
 * que a aba volta a ficar visível, porque um PWA aberto e deixado em
 * segundo plano nunca revalida sozinho.
 */
export function useServiceWorkerUpdate() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

    let registration: ServiceWorkerRegistration | null = null;

    const handleUpdateFound = (reg: ServiceWorkerRegistration) => {
      const installing = reg.installing;
      if (!installing) return;
      installing.addEventListener("statechange", () => {
        if (installing.state === "installed" && navigator.serviceWorker.controller) {
          setWaitingWorker(installing);
          setUpdateAvailable(true);
        }
      });
    };

    navigator.serviceWorker.register(`/sw.js?v=${__BUILD_ID__}`).then((reg) => {
      registration = reg;
      if (reg.waiting && navigator.serviceWorker.controller) {
        setWaitingWorker(reg.waiting);
        setUpdateAvailable(true);
      }
      reg.addEventListener("updatefound", () => handleUpdateFound(reg));
    }).catch(() => {});

    const onVisible = () => {
      if (document.visibilityState === "visible") registration?.update().catch(() => {});
    };
    document.addEventListener("visibilitychange", onVisible);

    let reloading = false;
    const onControllerChange = () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    };
  }, []);

  const applyUpdate = () => {
    waitingWorker?.postMessage("SKIP_WAITING");
  };

  return { updateAvailable, applyUpdate };
}

function isStandalone() {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as any).standalone === true
  );
}

function isIOS() {
  if (typeof navigator === "undefined") return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

/**
 * Tracks installability across platforms:
 * - Android/desktop Chrome: captures `beforeinstallprompt` for a native prompt.
 * - iOS Safari: no native prompt exists, so callers show manual "Share → Add to Home Screen" instructions instead.
 */
export function useInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [installed, setInstalled] = useState(isStandalone());

  useEffect(() => {
    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferredPrompt(null);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const promptInstall = async () => {
    if (!deferredPrompt) return false;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    return outcome === "accepted";
  };

  return {
    installed,
    canPromptInstall: !!deferredPrompt,
    isIOS: isIOS(),
    promptInstall,
  };
}

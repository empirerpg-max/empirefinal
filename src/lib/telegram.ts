import { useEffect, useState } from "react";

// ---------- Tipos mínimos do Telegram WebApp ----------
type HapticImpactStyle = "light" | "medium" | "heavy" | "rigid" | "soft";
type HapticNotificationType = "error" | "success" | "warning";

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        version?: string;
        ready: () => void;
        expand: () => void;
        close?: () => void;
        setHeaderColor?: (c: string) => void;
        setBackgroundColor?: (c: string) => void;
        openLink?: (url: string, options?: { try_instant_view?: boolean }) => void;
        openTelegramLink?: (url: string) => void;
        initDataUnsafe?: { user?: { id: number; first_name?: string; username?: string } };
        colorScheme?: "light" | "dark";
        themeParams?: Record<string, string>;
        onEvent?: (event: string, cb: () => void) => void;
        offEvent?: (event: string, cb: () => void) => void;
        BackButton?: {
          show: () => void;
          hide: () => void;
          onClick: (cb: () => void) => void;
          offClick: (cb: () => void) => void;
        };
        MainButton?: {
          text: string;
          show: () => void;
          hide: () => void;
          enable: () => void;
          disable: () => void;
          onClick: (cb: () => void) => void;
          offClick: (cb: () => void) => void;
          setText: (t: string) => void;
          showProgress: (leaveActive?: boolean) => void;
          hideProgress: () => void;
        };
        HapticFeedback?: {
          impactOccurred: (style: HapticImpactStyle) => void;
          notificationOccurred: (type: HapticNotificationType) => void;
          selectionChanged: () => void;
        };
      };
    };
  }
}

/** Compara versões "6.0" vs "6.1" — retorna true se v >= min */
export function tgVersionAtLeast(min: string): boolean {
  const v = (typeof window !== "undefined" ? window.Telegram?.WebApp?.version : "") || "0.0";
  const [a1, a2 = "0"] = v.split(".");
  const [b1, b2 = "0"] = min.split(".");
  const na = parseInt(a1) * 1000 + parseInt(a2);
  const nb = parseInt(b1) * 1000 + parseInt(b2);
  return na >= nb;
}


// ---------- Helpers de UX nativa ----------
const tg = () => (typeof window !== "undefined" ? window.Telegram?.WebApp : undefined);

export const haptic = {
  light: () => tg()?.HapticFeedback?.impactOccurred("light"),
  medium: () => tg()?.HapticFeedback?.impactOccurred("medium"),
  heavy: () => tg()?.HapticFeedback?.impactOccurred("heavy"),
  selection: () => tg()?.HapticFeedback?.selectionChanged(),
  success: () => tg()?.HapticFeedback?.notificationOccurred("success"),
  error: () => tg()?.HapticFeedback?.notificationOccurred("error"),
  warning: () => tg()?.HapticFeedback?.notificationOccurred("warning"),
};

/** Abre links externos respeitando o contexto do Telegram WebApp */
export function openExternal(url: string) {
  const w = tg();
  if (w?.openLink) {
    w.openLink(url, { try_instant_view: false });
  } else if (typeof window !== "undefined") {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

/** Hook para mostrar/ocultar o BackButton nativo do Telegram */
export function useTelegramBackButton(show: boolean, onClick: () => void) {
  useEffect(() => {
    const bb = tg()?.BackButton;
    if (!bb || !tgVersionAtLeast("6.1")) return;
    if (show) {
      try { bb.show(); bb.onClick(onClick); } catch {}
      return () => {
        try { bb.offClick(onClick); bb.hide(); } catch {}
      };
    } else {
      try { bb.hide(); } catch {}
    }
  }, [show, onClick]);
}


// ---------- Hook principal ----------
export interface TgUser {
  id: string;
  name?: string;
  username?: string;
  photo_url?: string;
  isTest: boolean;
}

export function useTelegramUser(): {
  user: TgUser | null;
  ready: boolean;
  setUserManually: (id: string, name?: string) => void;
} {
  const [user, setUser] = useState<TgUser | null>(null);
  const [ready, setReady] = useState(false);

  const setUserManually = (id: string, name?: string) => {
    const newUser = { id, name: name || "Usuário Manual", isTest: true };
    setUser(newUser);
    localStorage.setItem("tg_user_cache", JSON.stringify(newUser));
    setReady(true);
  };

  const userFromInitData = (str: string) => {
    try {
      const p = new URLSearchParams(str);
      const u = p.get("user");
      if (u) return JSON.parse(u);
    } catch {
      return null;
    }
  };

  useEffect(() => {
    if (typeof window === "undefined") return;

    const params = new URLSearchParams(window.location.search);
    const urlId =
      params.get("id") ||
      params.get("tg_id") ||
      params.get("user_id") ||
      params.get("uid") ||
      params.get("telegram_id") ||
      params.get("tgid");

    const nameFromUrl =
      params.get("name") ||
      params.get("username") ||
      params.get("first_name") ||
      params.get("user_name");

    if (urlId) {
      const newUser = {
        id: urlId,
        name: nameFromUrl || "Usuário #" + urlId.slice(-4),
        isTest: true,
      };
      setUser(newUser);
      localStorage.setItem("tg_user_cache", JSON.stringify(newUser));
      setReady(true);
      return;
    }

    // Fora do Telegram (app rodando standalone, pós-login próprio) não faz
    // sentido esperar ~2s de polling por um SDK que nunca vai aparecer —
    // usa o cache (gravado pelo login) na hora.
    if (!window.Telegram?.WebApp) {
      const cached = localStorage.getItem("tg_user_cache");
      if (cached) {
        try {
          setUser(JSON.parse(cached));
          setReady(true);
          return;
        } catch {}
      }
    }

    let attempts = 0;
    const maxAttempts = 20;

    const checkUser = () => {
      attempts++;
      const w = window.Telegram?.WebApp;
      const sdkUser = w?.initDataUnsafe?.user;

      if (sdkUser) {
        const newUser: TgUser = {
          id: String(sdkUser.id),
          name: sdkUser.first_name || sdkUser.username || "Usuário",
          username: sdkUser.username,
          photo_url: (sdkUser as any).photo_url,
          isTest: false,
        };
        setUser(newUser);
        localStorage.setItem("tg_user_cache", JSON.stringify(newUser));
        if (w) {
          w.ready();
          w.expand();
        }
        setReady(true);
        return true;
      }

      const searchParams = new URLSearchParams(window.location.search);
      const hash = window.location.hash.includes("?")
        ? window.location.hash.split("?")[1]
        : window.location.hash.slice(1);
      const hashParams = new URLSearchParams(hash);

      const webAppDataStr =
        hashParams.get("tgWebAppData") ||
        searchParams.get("tgWebAppData") ||
        searchParams.get("initData");

      if (webAppDataStr) {
        const u = userFromInitData(webAppDataStr);
        if (u) {
          const newUser = {
            id: String(u.id),
            name: u.first_name || u.username || "Usuário",
            isTest: false,
          };
          setUser(newUser);
          localStorage.setItem("tg_user_cache", JSON.stringify(newUser));
          setReady(true);
          return true;
        }
      }

      if (attempts >= maxAttempts) {
        const cached = localStorage.getItem("tg_user_cache");
        if (cached) {
          try {
            const parsed = JSON.parse(cached);
            setUser(parsed);
            setReady(true);
            return true;
          } catch {}
        }
        setUser({ id: "guest", name: "Guest", isTest: true });
        setReady(true);
        return true;
      }
      return false;
    };

    if (!checkUser()) {
      const interval = setInterval(() => {
        if (checkUser()) clearInterval(interval);
      }, 100);
      return () => clearInterval(interval);
    }
  }, []);

  return { user, ready, setUserManually };
}

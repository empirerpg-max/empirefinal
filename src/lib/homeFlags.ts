import { useEffect, useState } from "react";

export type HomeFlags = {
  meusArtistas: boolean;
  billboard: boolean;
  topPlataformas: boolean;
};

const DEFAULT_FLAGS: HomeFlags = {
  meusArtistas: true,
  billboard: true,
  topPlataformas: true,
};

// Geridas pelo painel Empire Admin (Cloudflare KV). Falha silenciosa e cai
// nos padrões (tudo ligado) se o endpoint não responder.
export function useHomeFlags(): HomeFlags {
  const [flags, setFlags] = useState<HomeFlags>(DEFAULT_FLAGS);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/flags")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data) setFlags({ ...DEFAULT_FLAGS, ...data });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return flags;
}

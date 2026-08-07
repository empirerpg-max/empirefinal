import { useEffect, useState } from "react";

export type HomeConfig = {
  order: string[];
  sections: {
    meusArtistas: { enabled: boolean };
    billboard: { enabled: boolean; fallbackUrl: string };
    topPlataformas: { enabled: boolean; links: Record<string, string> };
  };
};

export const DEFAULT_HOME_CONFIG: HomeConfig = {
  order: ["meusArtistas", "billboard", "topPlataformas"],
  sections: {
    meusArtistas: { enabled: true },
    billboard: {
      enabled: true,
      fallbackUrl: "https://empirerpg-max.github.io/central/charts.html?tab=BILLBOARD%20HOT%20100",
    },
    topPlataformas: {
      enabled: true,
      links: {
        spotify: "https://empirerpg-max.github.io/central/charts.html?tab=SPOTIFY",
        apple_music: "https://empirerpg-max.github.io/central/charts.html?tab=APPLE%20MUSIC",
        youtube: "https://empirerpg-max.github.io/central/charts.html?tab=YOUTUBE",
        billboard_200: "https://empirerpg-max.github.io/central/charts.html?tab=DADOS%20%C3%81LBUNS",
        digital_sales: "https://empirerpg-max.github.io/central/charts.html?tab=DIGITAL%20SALES",
      },
    },
  },
};

// Geridas pelo painel Empire Admin (Cloudflare KV). Falha silenciosa e cai
// nos padrões se o endpoint não responder.
export function useHomeConfig(): HomeConfig {
  const [config, setConfig] = useState<HomeConfig>(DEFAULT_HOME_CONFIG);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/flags")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: Partial<HomeConfig> | null) => {
        if (cancelled || !data) return;
        setConfig({
          order: data.order || DEFAULT_HOME_CONFIG.order,
          sections: {
            meusArtistas: { ...DEFAULT_HOME_CONFIG.sections.meusArtistas, ...data.sections?.meusArtistas },
            billboard: { ...DEFAULT_HOME_CONFIG.sections.billboard, ...data.sections?.billboard },
            topPlataformas: {
              ...DEFAULT_HOME_CONFIG.sections.topPlataformas,
              ...data.sections?.topPlataformas,
              links: {
                ...DEFAULT_HOME_CONFIG.sections.topPlataformas.links,
                ...data.sections?.topPlataformas?.links,
              },
            },
          },
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return config;
}

import { useEffect, useState } from "react";

export type HomeConfig = {
  order: string[];
  sections: {
    meusArtistas: { enabled: boolean };
    acervoRecente: { enabled: boolean };
    billboard: { enabled: boolean; fallbackUrl: string };
    topPlataformas: { enabled: boolean; links: Record<string, string> };
  };
};

export const DEFAULT_HOME_CONFIG: HomeConfig = {
  order: ["meusArtistas", "acervoRecente", "billboard", "topPlataformas"],
  sections: {
    meusArtistas: { enabled: true },
    acervoRecente: { enabled: true },
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
        // Config salva no Empire Admin pode ser de antes dessa seção
        // existir — sem isso, "Revistas & Entrevistas" some assim que o
        // painel salvar um `order` antigo (sem essa chave).
        const orderRemoto = data.order || DEFAULT_HOME_CONFIG.order;
        const order = orderRemoto.includes("acervoRecente")
          ? orderRemoto
          : [
              ...orderRemoto.slice(0, orderRemoto.indexOf("meusArtistas") + 1),
              "acervoRecente",
              ...orderRemoto.slice(orderRemoto.indexOf("meusArtistas") + 1),
            ];
        setConfig({
          order,
          sections: {
            meusArtistas: { ...DEFAULT_HOME_CONFIG.sections.meusArtistas, ...data.sections?.meusArtistas },
            acervoRecente: { ...DEFAULT_HOME_CONFIG.sections.acervoRecente, ...data.sections?.acervoRecente },
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

import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";
import { cloudflare } from "@cloudflare/vite-plugin";

// URL do Google Apps Script — lida do .env em dev, injetada pelo Worker em prod.
// Em dev o Vite faz proxy de /api/catalogo direto para o GAS (resolve o 502).
const GAS_URL = process.env.VITE_GAS_URL ||
  'https://script.google.com/macros/s/AKfycby7Epe3MHPMvje5OKtSlNn-tSWpowLPOJ7DVflFJqgZNOKCnN9IcGwWYL1QSeRtgJrQ7w/exec';

// Carimbo único por build — usado pra versionar a URL do service worker
// (/sw.js?v=BUILD_ID) e forçar o navegador a sempre buscar bytes frescos,
// sem depender de nenhum cache (CDN ou navegador) de uma URL antiga expirar
// sozinho. Também exibido no app como indicador visível de versão.
const BUILD_ID = process.env.BUILD_ID || String(Date.now());

export default defineConfig({
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
  },
  build: process.env.DEBUG_BUILD ? { minify: false, sourcemap: true } : undefined,
  plugins: [
    tsConfigPaths(),
    tailwindcss(),
    tanstackStart({ client: { entry: "client" }, server: { entry: "server" } }),
    viteReact(),
    cloudflare(),
  ],
  server: {
    proxy: {
      // Em dev: /api/catalogo?action=X  →  GAS?action=X  (sem CORS)
      '/api/catalogo': {
        target: GAS_URL,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/catalogo/, ''),
        // Garante que os query params (?action=...) são mantidos
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq, req) => {
            const url = new URL(req.url ?? '', 'http://localhost');
            // Remove o prefixo /api/catalogo do path e mantém os params
            proxyReq.path = url.search || '';
          });
        },
      },
    },
  },
});

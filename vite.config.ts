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

export default defineConfig({
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

// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, cloudflare (build-only),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// URL do Google Apps Script — lida do .env em dev, injetada pelo Worker em prod.
// Em dev o Vite faz proxy de /api/catalogo direto para o GAS (resolve o 502).
const GAS_URL = process.env.VITE_GAS_URL ||
  'https://script.google.com/macros/s/AKfycby7Epe3MHPMvje5OKtSlNn-tSWpowLPOJ7DVflFJqgZNOKCnN9IcGwWYL1QSeRtgJrQ7w/exec';

export default defineConfig({
  tanstackStart: {
    server: { entry: "server" },
  },
  vite: {
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
  },
});

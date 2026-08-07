// Workaround for a broken integration between @cloudflare/vite-plugin and
// @tanstack/react-start: Cloudflare's own `buildApp` build orchestration takes
// over instead of TanStack Start's coordinated one, so the SSR manifest never
// gets patched with the real client bundle filename — it ships with a
// dev-only virtual module reference (`/@id/virtual:tanstack-start-dev-client-entry`)
// that 404s in production, leaving the page blank. This patches the built
// manifest chunk to point at the real hydration entry chunk after every build.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DEV_ENTRY_URL = "/@id/virtual:tanstack-start-dev-client-entry";
const CLIENT_ASSETS_DIR = "dist/client/assets";
const WORKER_ASSETS_DIR = "dist/tanstack_start_app/assets";

function findRealClientEntry() {
  const files = readdirSync(CLIENT_ASSETS_DIR).filter((f) => f.endsWith(".js"));
  const matches = files.filter((f) => readFileSync(join(CLIENT_ASSETS_DIR, f), "utf8").includes("hydrateRoot("));
  if (matches.length !== 1) {
    throw new Error(
      `fix-start-manifest: esperava 1 chunk de hidratação em ${CLIENT_ASSETS_DIR}, encontrou ${matches.length}: ${matches.join(", ")}`
    );
  }
  return matches[0];
}

function patchManifest(realEntryFile) {
  const files = readdirSync(WORKER_ASSETS_DIR).filter((f) => f.startsWith("_tanstack-start-manifest_v-"));
  if (files.length === 0) {
    throw new Error(`fix-start-manifest: nenhum arquivo de manifest encontrado em ${WORKER_ASSETS_DIR}`);
  }
  const realEntryUrl = `/assets/${realEntryFile}`;
  for (const file of files) {
    const path = join(WORKER_ASSETS_DIR, file);
    const original = readFileSync(path, "utf8");
    if (!original.includes(DEV_ENTRY_URL)) {
      console.log(`fix-start-manifest: ${file} já está correto, pulando.`);
      continue;
    }
    writeFileSync(path, original.split(DEV_ENTRY_URL).join(realEntryUrl));
    console.log(`fix-start-manifest: ${file} corrigido -> ${realEntryUrl}`);
  }
}

patchManifest(findRealClientEntry());

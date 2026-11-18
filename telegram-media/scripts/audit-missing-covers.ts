// Auditoria SÓ DE LEITURA: confere se cada capa/thumb cadastrada nas abas
// Musicas, Albuns e Music Videos ainda existe no Google Drive. Lista as que
// sumiram (apagadas de vez) ou estão na lixeira (recuperáveis por 30 dias).
// Motivo: a limpeza de Stories vencidos apagava de vez a capa da música
// compartilhada no Story, e editar a capa de uma faixa apagava a capa
// compartilhada com outras (ambos corrigidos em 2026-11-18).
import { google } from "googleapis";

const SPREADSHEET_ID = process.env.SPREADSHEET_ID || "1XYa6Pzd-lou3fzqaZgjhBYNb3Je2PB9Slu7ozzOghUo";
const TABS = (process.env.TABS || "Musicas|Albuns|Music Videos").split("|");

const creds = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON || "{}");
const oauth = new google.auth.OAuth2(process.env.DRIVE_OAUTH_CLIENT_ID, process.env.DRIVE_OAUTH_CLIENT_SECRET);
oauth.setCredentials({ refresh_token: process.env.DRIVE_OAUTH_REFRESH_TOKEN });
const drive = google.drive({ version: "v3", auth: oauth });
const sheets = google.sheets({
  version: "v4",
  auth: new google.auth.GoogleAuth({
    credentials: { client_email: creds.client_email, private_key: creds.private_key },
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  }),
});

const norm = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

type Status = "ok" | "lixeira" | "sumiu" | "erro";
const cache = new Map<string, { status: Status; name?: string; detail?: string }>();

async function check(id: string) {
  const hit = cache.get(id);
  if (hit) return hit;
  let result: { status: Status; name?: string; detail?: string };
  try {
    const r = await drive.files.get({ fileId: id, fields: "name,trashed" });
    result = { status: r.data.trashed ? "lixeira" : "ok", name: r.data.name ?? undefined };
  } catch (e: any) {
    result = e?.code === 404 ? { status: "sumiu" } : { status: "erro", detail: e?.message };
  }
  cache.set(id, result);
  return result;
}

async function main() {
  const problems: string[] = [];
  let total = 0;
  for (const tab of TABS) {
    const { data } = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `${tab}!A:ZZ` });
    const rows = data.values || [];
    const header = (rows[0] || []).map((h) => norm(String(h ?? "")));
    const titleCol = header.findIndex((h) => h.includes("titulo"));
    const coverCols = header
      .map((h, i) => (h.includes("capa") || h.includes("thumb") || h.includes("cover") ? i : -1))
      .filter((i) => i >= 0);
    console.log(`Aba "${tab}": colunas de capa = ${coverCols.map((c) => rows[0][c]).join(", ") || "(nenhuma)"}`);
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const title = String(row[titleCol] ?? "").trim();
      if (!title) continue;
      for (const c of coverCols) {
        const cell = String(row[c] ?? "");
        if (!/drive\.google|googleusercontent|\/api\/media\//.test(cell)) continue;
        for (const m of cell.matchAll(/[-\w]{25,}/g)) {
          total += 1;
          const r = await check(m[0]);
          if (r.status !== "ok") {
            const line = `[${r.status.toUpperCase()}] ${tab} · linha ${i + 1} · "${title}" · ${rows[0][c]} · ${m[0]}${r.name ? ` (${r.name})` : ""}${r.detail ? ` — ${r.detail}` : ""}`;
            problems.push(line);
            console.log("  " + line);
          }
        }
      }
    }
  }
  console.log("\n──────── Resumo ────────");
  console.log(`${total} referência(s) de capa verificada(s), ${cache.size} arquivo(s) distinto(s).`);
  const count = (s: string) => problems.filter((p) => p.startsWith(`[${s}]`)).length;
  console.log(`SUMIU (apagada de vez): ${count("SUMIU")} · NA LIXEIRA (recuperável): ${count("LIXEIRA")} · ERRO: ${count("ERRO")}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

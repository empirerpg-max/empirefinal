// Diagnóstico SÓ DE LEITURA: para os títulos em SEARCH (separados por "|"),
// mostra todas as colunas das linhas da aba "Music Videos", testa cada ID do
// Drive encontrado nelas e procura no Drive (incluindo a lixeira) arquivos
// com nome parecido. Não altera nada em lugar nenhum.
import { google } from "googleapis";

const SPREADSHEET_ID = process.env.SPREADSHEET_ID || "1XYa6Pzd-lou3fzqaZgjhBYNb3Je2PB9Slu7ozzOghUo";
const SHEET_NAME = process.env.SHEET_NAME || "Music Videos";
const SEARCH = (process.env.SEARCH || "fuori rotta|bright night").split("|").map((s) => s.trim()).filter(Boolean);

const creds = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON || "{}");
const oauth = new google.auth.OAuth2(process.env.DRIVE_OAUTH_CLIENT_ID, process.env.DRIVE_OAUTH_CLIENT_SECRET);
oauth.setCredentials({ refresh_token: process.env.DRIVE_OAUTH_REFRESH_TOKEN });
const drive = google.drive({ version: "v3", auth: oauth });
const saAuth = new google.auth.GoogleAuth({
  credentials: { client_email: creds.client_email, private_key: creds.private_key },
  scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly", "https://www.googleapis.com/auth/drive.readonly"],
});
const sheets = google.sheets({ version: "v4", auth: saAuth });
const driveSA = google.drive({ version: "v3", auth: saAuth });

const norm = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const FIELDS = "id,name,size,mimeType,trashed,createdTime,modifiedTime,owners(emailAddress),parents";

async function tryGet(label: string, d: typeof drive, id: string) {
  try {
    const r = await d.files.get({ fileId: id, fields: FIELDS, supportsAllDrives: true });
    console.log(`    [${label}] OK: ${JSON.stringify(r.data)}`);
  } catch (e: any) {
    console.log(`    [${label}] ERRO ${e?.code ?? ""}: ${e?.message ?? e}`);
  }
}

async function main() {
  const about = await drive.about.get({ fields: "user(emailAddress)" });
  console.log(`Conta OAuth do Drive: ${about.data.user?.emailAddress}`);
  console.log(`Conta de serviço: ${creds.client_email}\n`);

  const { data } = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `${SHEET_NAME}!A:ZZ` });
  const rows = data.values || [];
  const header = rows[0] || [];

  for (const term of SEARCH) {
    console.log(`════════ "${term}" ════════`);
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row.some((c) => norm(String(c ?? "")).includes(norm(term)))) continue;
      console.log(`\n  Linha ${i + 1}:`);
      header.forEach((h, c) => {
        const v = String(row[c] ?? "").trim();
        if (v) console.log(`    ${h}: ${v.slice(0, 200)}`);
      });
      const ids = new Set<string>();
      for (const c of row) for (const m of String(c ?? "").matchAll(/[-\w]{25,}/g)) ids.add(m[0]);
      for (const id of ids) {
        console.log(`  ID ${id}:`);
        await tryGet("OAuth", drive, id);
        await tryGet("ContaServiço", driveSA, id);
      }
    }

    const words = term.split(/\s+/).map((w) => `name contains '${w.replace(/'/g, "\\'")}'`).join(" and ");
    for (const [label, d] of [["OAuth", drive], ["ContaServiço", driveSA]] as const) {
      try {
        const r = await d.files.list({
          q: words,
          fields: `files(${FIELDS})`,
          pageSize: 50,
          includeItemsFromAllDrives: true,
          supportsAllDrives: true,
        });
        console.log(`\n  Busca no Drive [${label}] por "${term}" (inclui lixeira): ${r.data.files?.length ?? 0} arquivo(s)`);
        for (const f of r.data.files || []) console.log(`    ${JSON.stringify(f)}`);
      } catch (e: any) {
        console.log(`  Busca [${label}] ERRO: ${e?.message ?? e}`);
      }
    }
    console.log("");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

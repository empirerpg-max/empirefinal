import { getGoogleAccessToken } from "../google/service-account";

export type GoogleSheetCellValue = string | number | boolean | null;
export type GoogleSheetRow = GoogleSheetCellValue[];
export type GoogleSheetMatrix = GoogleSheetRow[];
export type SheetRecord = Record<string, string>;

export const SPREADSHEETS = {
  principal: "1XYa6Pzd-lou3fzqaZgjhBYNb3Je2PB9Slu7ozzOghUo",
  registrosCharts: "1wNbtP78MrtrOc2Jb1ejXcHVjqndR2Vm4-3EIVqa8aOg",
  edicaoCharts: "1GPajSCp1TkJDEDOGZIrXxgZuNuRs7545buFntyDlpL8",
  usuarios: "1lFw9l76tYZYCDXhZsoiftIEzCvKcjCrI_oBpvUdwAlo",
} as const;

export type SpreadsheetKey = keyof typeof SPREADSHEETS;

const GOOGLE_SHEETS_API_BASE = "https://sheets.googleapis.com/v4/spreadsheets";
const SHEETS_READONLY_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";
const SHEETS_READWRITE_SCOPE = "https://www.googleapis.com/auth/spreadsheets";

function quoteSheetName(sheetName: string): string {
  const escaped = sheetName.replace(/'/g, "''");
  return `'${escaped}'`;
}

function buildA1Range(sheetName: string, range = "A:ZZ"): string {
  return `${quoteSheetName(sheetName)}!${range}`;
}

function resolveSpreadsheetId(keyOrId: SpreadsheetKey | string): string {
  if (keyOrId in SPREADSHEETS) {
    return SPREADSHEETS[keyOrId as SpreadsheetKey];
  }
  return keyOrId;
}

export function normalizeText(value: unknown): string {
  return String(value ?? "").trim();
}

export function normalizeComparison(value: unknown): string {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function normalizeHeader(value: unknown): string {
  return normalizeComparison(value)
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

function parseCsv(csvText: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentVal = "";
  let insideQuotes = false;

  for (let i = 0; i < csvText.length; i += 1) {
    const char = csvText[i];
    const nextChar = csvText[i + 1];

    if (char === '"') {
      if (insideQuotes && nextChar === '"') {
        currentVal += '"';
        i += 1;
      } else {
        insideQuotes = !insideQuotes;
      }
    } else if (char === "," && !insideQuotes) {
      currentRow.push(currentVal);
      currentVal = "";
    } else if ((char === "\r" || char === "\n") && !insideQuotes) {
      if (char === "\r" && nextChar === "\n") {
        i += 1;
      }
      currentRow.push(currentVal);
      rows.push(currentRow);
      currentRow = [];
      currentVal = "";
    } else {
      currentVal += char;
    }
  }

  if (currentVal || currentRow.length > 0) {
    currentRow.push(currentVal);
    rows.push(currentRow);
  }

  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

export async function fetchGVizCsv(spreadsheetId: string, sheetName: string): Promise<string[][]> {
  const gvizUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(
    sheetName,
  )}`;

  const res = await fetch(gvizUrl);
  if (!res.ok) {
    throw new Error(`GViz CSV export retornou HTTP ${res.status}`);
  }

  const csvText = await res.text();
  return parseCsv(csvText);
}

async function sheetsRequest<T>(path: string, init: RequestInit, scopes: string[]): Promise<T> {
  const accessToken = await getGoogleAccessToken(scopes);
  const response = await fetch(`${GOOGLE_SHEETS_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });

  const payload = (await response.json()) as T & {
    error?: {
      code?: number;
      message?: string;
      status?: string;
    };
  };

  if (!response.ok) {
    const message =
      payload.error?.message || `Google Sheets API respondeu com HTTP ${response.status}.`;
    throw new Error(message);
  }

  return payload;
}

interface GoogleSheetsValuesResponse {
  range?: string;
  majorDimension?: string;
  values?: string[][];
}

export interface SheetTabInfo {
  title: string;
  sheetId: number;
}

// Lista as abas (nome + gid) de uma planilha — usado pra resolver um gid de
// URL (ex: .../edit?gid=1234#gid=1234) pro nome real da aba, sem chutar.
export async function listSheetTabs(spreadsheetKeyOrId: SpreadsheetKey | string): Promise<SheetTabInfo[]> {
  const spreadsheetId = resolveSpreadsheetId(spreadsheetKeyOrId);
  const response = await sheetsRequest<{ sheets?: Array<{ properties?: { title?: string; sheetId?: number } }> }>(
    `/${spreadsheetId}?fields=sheets.properties.title,sheets.properties.sheetId`,
    { method: "GET" },
    [SHEETS_READONLY_SCOPE],
  );
  return (response.sheets || []).map((s) => ({
    title: s.properties?.title || "",
    sheetId: s.properties?.sheetId ?? -1,
  }));
}

export async function readValues(
  spreadsheetKeyOrId: SpreadsheetKey | string,
  sheetName: string,
  range = "A:ZZ",
): Promise<string[][]> {
  const spreadsheetId = resolveSpreadsheetId(spreadsheetKeyOrId);

  // Tenta primeiramente a Google Sheets API v4
  try {
    const a1Range = encodeURIComponent(buildA1Range(sheetName, range));
    const response = await sheetsRequest<GoogleSheetsValuesResponse>(
      `/${spreadsheetId}/values/${a1Range}?majorDimension=ROWS`,
      { method: "GET" },
      [SHEETS_READONLY_SCOPE],
    );
    if (response.values) return response.values;
  } catch (err) {
    console.warn(
      `[googleSheetsService] Falha na API v4 (${(err as Error).message}). Usando fallback GViz CSV para "${sheetName}"...`,
    );
  }

  // Fallback transparente para exportação pública GViz CSV
  try {
    return await fetchGVizCsv(spreadsheetId, sheetName);
  } catch (err) {
    console.error(`[googleSheetsService] Erro ao ler "${sheetName}" via GViz CSV:`, err);
    return [];
  }
}

export async function readSheetObjects(
  spreadsheetKeyOrId: SpreadsheetKey | string,
  sheetName: string,
  range = "A:ZZ",
): Promise<SheetRecord[]> {
  const rows = await readValues(spreadsheetKeyOrId, sheetName, range);
  if (rows.length < 2) return [];

  const rawHeaders = rows[0].map((header, index) => {
    const normalized = normalizeHeader(header);
    return normalized || `coluna_${index + 1}`;
  });
  const headers = dedupeHeaders(sheetName, rawHeaders);

  return rows
    .slice(1)
    .filter((row) => row.some((cell) => normalizeText(cell)))
    .map((row) => {
      const record: SheetRecord = {};
      headers.forEach((header, index) => {
        record[header] = normalizeText(row[index]);
      });
      return record;
    });
}

/**
 * Duas colunas podem ter o mesmo cabeçalho (ex.: a aba "Music Videos" tem
 * "ID da mensagem" duas vezes — uma para o grupo original do Telegram, outra
 * para o grupo de arquivo, que é o que o app realmente lê). Em vez de
 * descartar a segunda em silêncio, sufixamos com _2, _3... para preservar
 * as duas; quem consome decide explicitamente qual das colunas usar.
 */
export function dedupeHeaders(sheetName: string, headers: string[]): string[] {
  const seen = new Map<string, number>();
  return headers.map((header, index) => {
    const count = seen.get(header) ?? 0;
    seen.set(header, count + 1);
    if (count === 0) return header;
    const suffixed = `${header}_${count + 1}`;
    console.warn(
      `[googleSheetsService] Cabeçalhos duplicados na aba "${sheetName}": coluna ${index + 1} (chave "${header}") virou "${suffixed}" para não colidir com uma coluna anterior.`,
    );
    return suffixed;
  });
}

export async function findRows(
  spreadsheetKeyOrId: SpreadsheetKey | string,
  sheetName: string,
  predicate: (row: string[], rowIndex: number) => boolean,
  range = "A:ZZ",
): Promise<{ rowIndex: number; row: string[] }[]> {
  const rows = await readValues(spreadsheetKeyOrId, sheetName, range);
  const matches: { rowIndex: number; row: string[] }[] = [];

  rows.forEach((row, index) => {
    if (predicate(row, index)) {
      matches.push({ rowIndex: index + 1, row });
    }
  });

  return matches;
}

export async function updateValues(
  spreadsheetKeyOrId: SpreadsheetKey | string,
  sheetName: string,
  range: string,
  values: GoogleSheetMatrix,
): Promise<void> {
  const spreadsheetId = resolveSpreadsheetId(spreadsheetKeyOrId);
  try {
    const a1Range = encodeURIComponent(buildA1Range(sheetName, range));
    await sheetsRequest(
      `/${spreadsheetId}/values/${a1Range}?valueInputOption=USER_ENTERED`,
      {
        method: "PUT",
        body: JSON.stringify({
          majorDimension: "ROWS",
          values,
        }),
      },
      [SHEETS_READWRITE_SCOPE],
    );
  } catch (err) {
    console.warn(
      `[googleSheetsService] Não foi possível atualizar valores na planilha (${(err as Error).message})`,
    );
  }
}

interface GoogleSheetsAppendResponse {
  updates?: {
    updatedRange?: string;
  };
}

/**
 * Anexa uma linha e devolve o número da linha real onde ela caiu (1-based,
 * igual A1) — usado pra permitir reagir com emoji imediatamente após postar
 * um comentário, sem precisar reler a aba inteira pra achar a linha.
 * `null` quando a gravação falha (comportamento silencioso já existente).
 */
export async function appendRow(
  spreadsheetKeyOrId: SpreadsheetKey | string,
  sheetName: string,
  values: GoogleSheetRow,
  range = "A:ZZ",
): Promise<number | null> {
  const spreadsheetId = resolveSpreadsheetId(spreadsheetKeyOrId);
  try {
    const a1Range = encodeURIComponent(buildA1Range(sheetName, range));
    const result = await sheetsRequest<GoogleSheetsAppendResponse>(
      `/${spreadsheetId}/values/${a1Range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
      {
        method: "POST",
        body: JSON.stringify({
          majorDimension: "ROWS",
          values: [values],
        }),
      },
      [SHEETS_READWRITE_SCOPE],
    );
    const updatedRange = result.updates?.updatedRange || "";
    // updatedRange vem tipo "'Comentarios_Musicas'!A123:D123" — extrai o 123.
    const match = updatedRange.match(/![A-Z]+(\d+)/);
    return match ? parseInt(match[1], 10) : null;
  } catch (err) {
    console.warn(
      `[googleSheetsService] Não foi possível anexar linha na planilha (${(err as Error).message})`,
    );
    return null;
  }
}

export const googleSheetsService = {
  SPREADSHEETS,
  readValues,
  readSheetObjects,
  findRows,
  updateValues,
  appendRow,
  principal: {
    readValues: (sheetName: string, range?: string) => readValues("principal", sheetName, range),
    readSheetObjects: (sheetName: string, range?: string) =>
      readSheetObjects("principal", sheetName, range),
    findRows: (
      sheetName: string,
      predicate: (row: string[], index: number) => boolean,
      range?: string,
    ) => findRows("principal", sheetName, predicate, range),
    updateValues: (sheetName: string, range: string, values: GoogleSheetMatrix) =>
      updateValues("principal", sheetName, range, values),
    appendRow: (sheetName: string, values: GoogleSheetRow, range?: string) =>
      appendRow("principal", sheetName, values, range),
  },
  registrosCharts: {
    readValues: (sheetName: string, range?: string) =>
      readValues("registrosCharts", sheetName, range),
    readSheetObjects: (sheetName: string, range?: string) =>
      readSheetObjects("registrosCharts", sheetName, range),
    findRows: (
      sheetName: string,
      predicate: (row: string[], index: number) => boolean,
      range?: string,
    ) => findRows("registrosCharts", sheetName, predicate, range),
    updateValues: (sheetName: string, range: string, values: GoogleSheetMatrix) =>
      updateValues("registrosCharts", sheetName, range, values),
    appendRow: (sheetName: string, values: GoogleSheetRow, range?: string) =>
      appendRow("registrosCharts", sheetName, values, range),
  },
  edicaoCharts: {
    readValues: (sheetName: string, range?: string) => readValues("edicaoCharts", sheetName, range),
    readSheetObjects: (sheetName: string, range?: string) =>
      readSheetObjects("edicaoCharts", sheetName, range),
    findRows: (
      sheetName: string,
      predicate: (row: string[], index: number) => boolean,
      range?: string,
    ) => findRows("edicaoCharts", sheetName, predicate, range),
    updateValues: (sheetName: string, range: string, values: GoogleSheetMatrix) =>
      updateValues("edicaoCharts", sheetName, range, values),
    appendRow: (sheetName: string, values: GoogleSheetRow, range?: string) =>
      appendRow("edicaoCharts", sheetName, values, range),
  },
  usuarios: {
    readValues: (sheetName: string, range?: string) => readValues("usuarios", sheetName, range),
    readSheetObjects: (sheetName: string, range?: string) =>
      readSheetObjects("usuarios", sheetName, range),
    findRows: (
      sheetName: string,
      predicate: (row: string[], index: number) => boolean,
      range?: string,
    ) => findRows("usuarios", sheetName, predicate, range),
    updateValues: (sheetName: string, range: string, values: GoogleSheetMatrix) =>
      updateValues("usuarios", sheetName, range, values),
    appendRow: (sheetName: string, values: GoogleSheetRow, range?: string) =>
      appendRow("usuarios", sheetName, values, range),
  },
};

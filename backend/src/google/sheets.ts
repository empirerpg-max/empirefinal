import { getGoogleAccessToken } from "./service-account";

export type GoogleSheetCellValue = string | number | boolean | null;
export type GoogleSheetRow = GoogleSheetCellValue[];
export type GoogleSheetMatrix = GoogleSheetRow[];

const GOOGLE_SHEETS_API_BASE = "https://sheets.googleapis.com/v4/spreadsheets";
const SHEETS_READONLY_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";
const SHEETS_READWRITE_SCOPE = "https://www.googleapis.com/auth/spreadsheets";

export const EMPIRE_PLAY_SHEETS = {
  principal: "1XYa6Pzd-lou3fzqaZgjhBYNb3Je2PB9Slu7ozzOghUo",
  registrosCharts: "1wNbtP78MrtrOc2Jb1ejXcHVjqndR2Vm4-3EIVqa8aOg",
  edicaoCharts: "1GPajSCp1TkJDEDOGZIrXxgZuNuRs7545buFntyDlpL8",
} as const;

function quoteSheetName(sheetName: string): string {
  const escaped = sheetName.replace(/'/g, "''");
  return `'${escaped}'`;
}

function buildA1Range(sheetName: string, range = "A:ZZ"): string {
  return `${quoteSheetName(sheetName)}!${range}`;
}

async function googleSheetsRequest<T>(
  path: string,
  init: RequestInit,
  scopes: string[],
): Promise<T> {
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
      payload.error?.message || `Google Sheets respondeu com HTTP ${response.status}.`;
    throw new Error(message);
  }

  return payload;
}

interface GoogleSheetsValuesResponse {
  range?: string;
  majorDimension?: string;
  values?: string[][];
}

export interface SpreadsheetHelper {
  spreadsheetId: string;
  readValues(sheetName: string, range?: string): Promise<string[][]>;
  appendRow(sheetName: string, values: GoogleSheetRow, range?: string): Promise<void>;
  updateValues(sheetName: string, range: string, values: GoogleSheetMatrix): Promise<void>;
}

function createSpreadsheetHelper(spreadsheetId: string): SpreadsheetHelper {
  return {
    spreadsheetId,
    async readValues(sheetName: string, range = "A:ZZ"): Promise<string[][]> {
      const a1Range = encodeURIComponent(buildA1Range(sheetName, range));
      const response = await googleSheetsRequest<GoogleSheetsValuesResponse>(
        `/${spreadsheetId}/values/${a1Range}?majorDimension=ROWS`,
        { method: "GET" },
        [SHEETS_READONLY_SCOPE],
      );

      return response.values ?? [];
    },

    async appendRow(sheetName: string, values: GoogleSheetRow, range = "A:ZZ"): Promise<void> {
      const a1Range = encodeURIComponent(buildA1Range(sheetName, range));
      await googleSheetsRequest(
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
    },

    async updateValues(sheetName: string, range: string, values: GoogleSheetMatrix): Promise<void> {
      const a1Range = encodeURIComponent(buildA1Range(sheetName, range));
      await googleSheetsRequest(
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
    },
  };
}

export const empireSheets = {
  principal: createSpreadsheetHelper(EMPIRE_PLAY_SHEETS.principal),
  registrosCharts: createSpreadsheetHelper(EMPIRE_PLAY_SHEETS.registrosCharts),
  edicaoCharts: createSpreadsheetHelper(EMPIRE_PLAY_SHEETS.edicaoCharts),
} as const;

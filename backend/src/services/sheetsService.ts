import { getGoogleAccessToken } from "../google/service-account";
import {
  normalizeComparison,
  normalizeHeader,
  normalizeText,
  SheetRecord,
  GoogleSheetCellValue,
  GoogleSheetRow,
  GoogleSheetMatrix,
  fetchGVizCsv,
} from "./googleSheetsService";

export const PRINCIPAL_SPREADSHEET_ID = "1XYa6Pzd-lou3fzqaZgjhBYNb3Je2PB9Slu7ozzOghUo";

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

/**
 * Lê os valores brutos (matriz de strings) de uma aba na planilha principal
 */
export async function readValues(sheetName: string, range = "A:ZZ"): Promise<string[][]> {
  try {
    const a1Range = encodeURIComponent(buildA1Range(sheetName, range));
    const response = await sheetsRequest<GoogleSheetsValuesResponse>(
      `/${PRINCIPAL_SPREADSHEET_ID}/values/${a1Range}?majorDimension=ROWS`,
      { method: "GET" },
      [SHEETS_READONLY_SCOPE],
    );

    if (response.values && response.values.length > 0) {
      return response.values;
    }
  } catch (err) {
    console.warn(
      `[sheetsService] API v4 indisponível (${(err as Error).message}). Usando fallback GViz CSV para "${sheetName}"...`,
    );
  }

  try {
    return await fetchGVizCsv(PRINCIPAL_SPREADSHEET_ID, sheetName);
  } catch (err) {
    console.error(`[sheetsService] Erro ao ler "${sheetName}" via GViz CSV:`, err);
    return [];
  }
}

/**
 * Lê uma aba e converte as linhas em objetos utilizando o cabeçalho como chaves normalizadas
 */
export async function readSheetObjects(sheetName: string, range = "A:ZZ"): Promise<SheetRecord[]> {
  const rows = await readValues(sheetName, range);
  if (rows.length < 2) return [];

  const headers = rows[0].map((header, index) => {
    const normalized = normalizeHeader(header);
    return normalized || `coluna_${index + 1}`;
  });
  warnOnDuplicateHeaders(sheetName, headers);

  return rows
    .slice(1)
    .filter((row) => row.some((cell) => normalizeText(cell)))
    .map((row) => {
      const record: SheetRecord = {};
      headers.forEach((header, index) => {
        if (header in record) return;
        record[header] = normalizeText(row[index]);
      });
      return record;
    });
}

function warnOnDuplicateHeaders(sheetName: string, headers: string[]): void {
  const seen = new Map<string, number>();
  headers.forEach((header, index) => {
    if (seen.has(header)) {
      console.warn(
        `[sheetsService] Cabeçalhos duplicados na aba "${sheetName}": coluna ${index + 1} colide com a coluna ${
          (seen.get(header) as number) + 1
        } (chave "${header}"). Usando o valor da primeira ocorrência.`,
      );
    } else {
      seen.set(header, index);
    }
  });
}

/**
 * Busca linhas conforme um predicado
 */
export async function findRows(
  sheetName: string,
  predicate: (row: string[], rowIndex: number) => boolean,
  range = "A:ZZ",
): Promise<{ rowIndex: number; row: string[] }[]> {
  const rows = await readValues(sheetName, range);
  const matches: { rowIndex: number; row: string[] }[] = [];

  rows.forEach((row, index) => {
    if (predicate(row, index)) {
      matches.push({ rowIndex: index + 1, row });
    }
  });

  return matches;
}

/**
 * Atualiza valores em um intervalo A1
 */
export async function updateValues(
  sheetName: string,
  range: string,
  values: GoogleSheetMatrix,
): Promise<void> {
  const a1Range = encodeURIComponent(buildA1Range(sheetName, range));
  await sheetsRequest(
    `/${PRINCIPAL_SPREADSHEET_ID}/values/${a1Range}?valueInputOption=USER_ENTERED`,
    {
      method: "PUT",
      body: JSON.stringify({
        majorDimension: "ROWS",
        values,
      }),
    },
    [SHEETS_READWRITE_SCOPE],
  );
}

/**
 * Adiciona uma nova linha ao final da aba
 */
export async function appendRow(
  sheetName: string,
  values: GoogleSheetRow,
  range = "A:ZZ",
): Promise<void> {
  const a1Range = encodeURIComponent(buildA1Range(sheetName, range));
  await sheetsRequest(
    `/${PRINCIPAL_SPREADSHEET_ID}/values/${a1Range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    {
      method: "POST",
      body: JSON.stringify({
        majorDimension: "ROWS",
        values: [values],
      }),
    },
    [SHEETS_READWRITE_SCOPE],
  );
}

export function toCamelCase(str: string): string {
  if (!str) return "";
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9\s_]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[\s_]+(.)/g, (_, c) => c.toUpperCase());
}

/**
 * Lê uma aba e converte as linhas em objetos utilizando o cabeçalho formatado em camelCase
 */
export async function readSheetObjectsCamelCase(
  sheetName: string,
  range = "A:ZZ",
): Promise<Record<string, string>[]> {
  const rows = await readValues(sheetName, range);
  if (rows.length < 2) return [];

  const headers = rows[0].map((header, index) => {
    const camel = toCamelCase(header);
    return camel || `coluna${index + 1}`;
  });
  warnOnDuplicateHeaders(sheetName, headers);

  return rows
    .slice(1)
    .filter((row) => row.some((cell) => normalizeText(cell)))
    .map((row) => {
      const record: Record<string, string> = {};
      headers.forEach((header, index) => {
        if (header in record) return;
        record[header] = normalizeText(row[index]);
      });
      return record;
    });
}

export const sheetsService = {
  spreadsheetId: PRINCIPAL_SPREADSHEET_ID,
  readValues,
  readSheetObjects,
  readSheetObjectsCamelCase,
  findRows,
  updateValues,
  appendRow,
};

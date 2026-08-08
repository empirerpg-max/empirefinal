import {
  readValues as readValuesFor,
  readSheetObjects as readSheetObjectsFor,
  findRows as findRowsFor,
  updateValues as updateValuesFor,
  appendRow as appendRowFor,
  normalizeText,
  SheetRecord,
  GoogleSheetRow,
  GoogleSheetMatrix,
} from "./googleSheetsService";

export const PRINCIPAL_SPREADSHEET_ID = "1XYa6Pzd-lou3fzqaZgjhBYNb3Je2PB9Slu7ozzOghUo";

/**
 * Wrappers finos em torno de googleSheetsService, fixados na planilha
 * principal. Mantidos como funções soltas (em vez de só o objeto
 * `sheetsService` abaixo) para preservar a API já usada pelos controllers.
 */

export async function readValues(sheetName: string, range = "A:ZZ"): Promise<string[][]> {
  return readValuesFor(PRINCIPAL_SPREADSHEET_ID, sheetName, range);
}

export async function readSheetObjects(sheetName: string, range = "A:ZZ"): Promise<SheetRecord[]> {
  return readSheetObjectsFor(PRINCIPAL_SPREADSHEET_ID, sheetName, range);
}

export async function findRows(
  sheetName: string,
  predicate: (row: string[], rowIndex: number) => boolean,
  range = "A:ZZ",
): Promise<{ rowIndex: number; row: string[] }[]> {
  return findRowsFor(PRINCIPAL_SPREADSHEET_ID, sheetName, predicate, range);
}

export async function updateValues(
  sheetName: string,
  range: string,
  values: GoogleSheetMatrix,
): Promise<void> {
  return updateValuesFor(PRINCIPAL_SPREADSHEET_ID, sheetName, range, values);
}

export async function appendRow(
  sheetName: string,
  values: GoogleSheetRow,
  range = "A:ZZ",
): Promise<void> {
  return appendRowFor(PRINCIPAL_SPREADSHEET_ID, sheetName, values, range);
}

export function toCamelCase(str: string): string {
  if (!str) return "";
  return str
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9\s_]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[\s_]+(.)/g, (_, c) => c.toUpperCase());
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

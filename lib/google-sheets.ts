import { google } from "googleapis";
import type { SheetRow, SheetStats, SheetTab } from "./types";

function getAuth() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!email || !key) throw new Error("Google service account credentials not configured");

  return new google.auth.JWT({
    email,
    key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

function getSheetId(): string {
  const id = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  if (!id) throw new Error("GOOGLE_SHEETS_SPREADSHEET_ID not set");
  return id;
}

function resolveSheetName(sheetName?: string): string {
  return sheetName || process.env.GOOGLE_SHEETS_SHEET_NAME || "Sheet1";
}

/** List all tabs in the spreadsheet */
export async function getSheetTabs(): Promise<SheetTab[]> {
  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });

  const resp = await sheets.spreadsheets.get({
    spreadsheetId: getSheetId(),
    fields: "sheets.properties",
  });

  return (resp.data.sheets ?? []).map((s) => ({
    title: s.properties?.title ?? "Untitled",
    index: s.properties?.index ?? 0,
    rowCount: s.properties?.gridProperties?.rowCount ?? 0,
  }));
}

/** Read all rows from the sheet. Expected columns: A:Full Address | B:House Number | C:Street | D:Borough | E:Owner Name | F:Billing Name and Address */
export async function readAllRows(sheetName?: string): Promise<SheetRow[]> {
  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });
  const name = resolveSheetName(sheetName);

  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: getSheetId(),
    range: `${name}!A:F`,
  });

  const rows = resp.data.values ?? [];
  if (rows.length <= 1) return []; // header only or empty

  return rows.slice(1).map((row, i) => ({
    rowIndex: i + 2, // 1-based, skip header
    fullAddress: row[0] ?? "",
    houseNumber: row[1] ?? "",
    street: row[2] ?? "",
    borough: row[3] ?? "",
    ownerName: row[4] ?? "",
    billingNameAndAddress: row[5] ?? "",
  }));
}

/** Get sheet statistics */
export async function getSheetStats(sheetName?: string): Promise<SheetStats> {
  const rows = await readAllRows(sheetName);
  const filled = rows.filter((r) => r.ownerName || r.billingNameAndAddress).length;
  return {
    totalRows: rows.length,
    filledRows: filled,
    emptyRows: rows.length - filled,
  };
}

/** Write owner name and billing info to a specific row */
export async function writeRowResult(
  rowIndex: number,
  ownerName: string,
  billingNameAndAddress: string,
  sheetName?: string
): Promise<void> {
  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });
  const name = resolveSheetName(sheetName);

  await sheets.spreadsheets.values.update({
    spreadsheetId: getSheetId(),
    range: `${name}!E${rowIndex}:F${rowIndex}`,
    valueInputOption: "RAW",
    requestBody: {
      values: [[ownerName, billingNameAndAddress]],
    },
  });
}

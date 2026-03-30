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

/** Read all rows from the sheet. Columns: A:Full Address | B:House# | C:Street | D:Borough | E:Owner | F:Billing | G:Block | H:Lot | I:Parcel Status | J:Parcel Details | K:Processed | L:Estate Status | M:Estate File Number */
export async function readAllRows(sheetName?: string): Promise<SheetRow[]> {
  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });
  const name = resolveSheetName(sheetName);

  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: getSheetId(),
    range: `${name}!A:M`,
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
    block: row[6] ?? "",
    lot: row[7] ?? "",
    parcelStatus: row[8] ?? "",
    parcelDetails: row[9] ?? "",
    processed: row[10] ?? "",
    estateStatus: row[11] ?? "",
    estateFileNumber: row[12] ?? "",
  }));
}

/** Get sheet statistics — uses the Processed column (G) as the source of truth */
export async function getSheetStats(sheetName?: string): Promise<SheetStats> {
  const rows = await readAllRows(sheetName);
  const filled = rows.filter((r) => !!r.processed).length;
  const parcelScanned = rows.filter((r) => !!r.parcelStatus).length;
  const goodLeads = rows.filter((r) => r.parcelStatus === "GOOD_LEAD");
  const estateChecked = goodLeads.filter((r) => !!r.estateStatus).length;
  return {
    totalRows: rows.length,
    filledRows: filled,
    emptyRows: rows.length - filled,
    parcelScanned,
    parcelRemaining: rows.length - parcelScanned,
    estateChecked,
    estateRemaining: goodLeads.length - estateChecked,
  };
}

/** Write owner name, billing info, and mark as processed */
export async function writeRowResult(
  rowIndex: number,
  ownerName: string,
  billingNameAndAddress: string,
  sheetName?: string
): Promise<void> {
  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });
  const name = resolveSheetName(sheetName);

  // Write owner + billing to E:F
  await sheets.spreadsheets.values.update({
    spreadsheetId: getSheetId(),
    range: `${name}!E${rowIndex}:F${rowIndex}`,
    valueInputOption: "RAW",
    requestBody: {
      values: [[ownerName, billingNameAndAddress]],
    },
  });

  // Write processed timestamp to K
  await sheets.spreadsheets.values.update({
    spreadsheetId: getSheetId(),
    range: `${name}!K${rowIndex}`,
    valueInputOption: "RAW",
    requestBody: {
      values: [[new Date().toISOString()]],
    },
  });
}

/** Write block and lot values to columns G and H */
export async function writeBlockLot(
  rowIndex: number,
  block: string,
  lot: string,
  sheetName?: string
): Promise<void> {
  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });
  const name = resolveSheetName(sheetName);

  await sheets.spreadsheets.values.update({
    spreadsheetId: getSheetId(),
    range: `${name}!G${rowIndex}:H${rowIndex}`,
    valueInputOption: "RAW",
    requestBody: {
      values: [[block, lot]],
    },
  });
}

/** Write parcel analysis result to columns I and J */
export async function writeParcelResult(
  rowIndex: number,
  status: string,
  details: string,
  sheetName?: string
): Promise<void> {
  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });
  const name = resolveSheetName(sheetName);

  await sheets.spreadsheets.values.update({
    spreadsheetId: getSheetId(),
    range: `${name}!I${rowIndex}:J${rowIndex}`,
    valueInputOption: "RAW",
    requestBody: {
      values: [[status, details]],
    },
  });
}

/** Write estate check result to columns L and M */
export async function writeEstateResult(
  rowIndex: number,
  status: string,
  fileNumber: string,
  sheetName?: string
): Promise<void> {
  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });
  const name = resolveSheetName(sheetName);

  await sheets.spreadsheets.values.update({
    spreadsheetId: getSheetId(),
    range: `${name}!L${rowIndex}:M${rowIndex}`,
    valueInputOption: "RAW",
    requestBody: {
      values: [[status, fileNumber]],
    },
  });
}

/** Count rows that have block/lot but no parcelStatus */
export async function getParcelStats(sheetName?: string): Promise<{ pending: number; completed: number }> {
  const rows = await readAllRows(sheetName);
  const withBlockLot = rows.filter((r) => !!r.block && !!r.lot);
  const completed = withBlockLot.filter((r) => !!r.parcelStatus).length;
  return { pending: withBlockLot.length - completed, completed };
}

import { NextResponse } from "next/server";
import { getSheetTabs } from "@/lib/google-sheets";

export async function GET() {
  try {
    const tabs = await getSheetTabs();
    const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID || "";
    return NextResponse.json({
      tabs,
      sheetUrl: spreadsheetId
        ? `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`
        : null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to list tabs";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

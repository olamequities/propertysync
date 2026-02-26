import { NextRequest, NextResponse } from "next/server";
import { readAllRows } from "@/lib/google-sheets";

export async function GET(request: NextRequest) {
  try {
    const tab = request.nextUrl.searchParams.get("tab") || undefined;
    const rows = await readAllRows(tab);
    return NextResponse.json(rows);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to read rows";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

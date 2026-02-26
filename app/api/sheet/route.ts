import { NextRequest, NextResponse } from "next/server";
import { getSheetStats } from "@/lib/google-sheets";

export async function GET(request: NextRequest) {
  try {
    const tab = request.nextUrl.searchParams.get("tab") || undefined;
    const stats = await getSheetStats(tab);
    return NextResponse.json(stats);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to read sheet";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

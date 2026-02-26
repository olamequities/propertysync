import { NextRequest, NextResponse } from "next/server";
import { startSync, isRunning, getActiveJobId } from "@/lib/sync-engine";

export async function GET() {
  const jobId = getActiveJobId();
  return NextResponse.json({ running: !!jobId, jobId });
}

export async function POST(request: NextRequest) {
  try {
    if (isRunning()) {
      return NextResponse.json(
        { error: "A sync is already running", jobId: getActiveJobId() },
        { status: 409 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const { sheetName, startRow, endRow } = body as {
      sheetName?: string;
      startRow?: number;
      endRow?: number;
    };

    const jobId = startSync({ sheetName, startRow, endRow });
    return NextResponse.json({ jobId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to start sync";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

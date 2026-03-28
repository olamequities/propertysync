import { NextRequest, NextResponse } from "next/server";
import { startParcelScan, isParcelRunning, getActiveParcelJobId } from "@/lib/parcel-engine";

export async function GET() {
  const jobId = getActiveParcelJobId();
  return NextResponse.json({ running: !!jobId, jobId });
}

export async function POST(request: NextRequest) {
  try {
    if (isParcelRunning()) {
      return NextResponse.json(
        { error: "A parcel scan is already running", jobId: getActiveParcelJobId() },
        { status: 409 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const { sheetName } = body as { sheetName?: string };

    const jobId = startParcelScan({ sheetName });
    return NextResponse.json({ jobId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to start parcel scan";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { cancelJob } from "@/lib/sync-engine";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params;
  const cancelled = cancelJob(jobId);

  if (!cancelled) {
    return NextResponse.json({ error: "Job not found or already finished" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}

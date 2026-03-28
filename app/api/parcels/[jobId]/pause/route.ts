import { NextRequest, NextResponse } from "next/server";
import { pauseParcelJob, resumeParcelJob, getParcelJob } from "@/lib/parcel-engine";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params;
  const job = getParcelJob(jobId);

  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  if (job.status === "paused") {
    const resumed = resumeParcelJob(jobId);
    if (!resumed) return NextResponse.json({ error: "Failed to resume" }, { status: 400 });
    return NextResponse.json({ ok: true, status: "running" });
  }

  if (job.status === "running") {
    const paused = pauseParcelJob(jobId);
    if (!paused) return NextResponse.json({ error: "Failed to pause" }, { status: 400 });
    return NextResponse.json({ ok: true, status: "paused" });
  }

  return NextResponse.json({ error: "Job is not running or paused" }, { status: 400 });
}

import { NextRequest, NextResponse } from "next/server";
import { pauseJob, resumeJob, getJob } from "@/lib/sync-engine";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params;
  const job = getJob(jobId);

  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  if (job.status === "paused") {
    const resumed = resumeJob(jobId);
    if (!resumed) return NextResponse.json({ error: "Failed to resume" }, { status: 400 });
    return NextResponse.json({ ok: true, status: "running" });
  }

  if (job.status === "running") {
    const paused = pauseJob(jobId);
    if (!paused) return NextResponse.json({ error: "Failed to pause" }, { status: 400 });
    return NextResponse.json({ ok: true, status: "paused" });
  }

  return NextResponse.json({ error: "Job is not running or paused" }, { status: 400 });
}

import { NextRequest, NextResponse } from "next/server";
import {
  startEstateScan,
  isEstateRunning,
  getActiveEstateJobId,
  getEstateSearchList,
  getEstateJob,
} from "@/lib/estate-engine";

export async function GET() {
  const jobId = getActiveEstateJobId();
  return NextResponse.json({ running: !!jobId, jobId });
}

export async function POST(request: NextRequest) {
  try {
    if (isEstateRunning()) {
      return NextResponse.json(
        { error: "An estate scan is already running", jobId: getActiveEstateJobId() },
        { status: 409 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const { sheetName } = body as { sheetName?: string };

    // Get the search list
    const searches = await getEstateSearchList(sheetName);
    if (searches.length === 0) {
      return NextResponse.json(
        { error: "No GOOD_LEAD rows without estate status found" },
        { status: 400 }
      );
    }

    const jobId = startEstateScan({ sheetName });
    const job = getEstateJob(jobId);
    if (job) {
      job.total = searches.length;
      job.status = "waiting_captcha";
    }

    // The Python estate scanner runs separately (user launches it).
    // The portal tracks progress via the job and SSE.
    // The scanner reports results back via POST /api/estate/[jobId].

    return NextResponse.json({ jobId, total: searches.length, searches });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to start estate scan";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

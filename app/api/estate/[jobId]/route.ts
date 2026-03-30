import { NextRequest } from "next/server";
import { getEstateJob } from "@/lib/estate-engine";
import type { EstateProgress } from "@/lib/estate-engine";

function slimSnapshot(job: EstateProgress) {
  return {
    jobId: job.jobId,
    status: job.status,
    total: job.total,
    processed: job.processed,
    succeeded: job.succeeded,
    failed: job.failed,
    currentName: job.currentName,
    errors: job.errors.slice(-5),
    startedAt: job.startedAt,
    lastCompletedRow: job.lastCompletedRow,
  };
}

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params;
  const job = getEstateJob(jobId);

  if (!job) {
    return new Response(JSON.stringify({ error: "Job not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const encoder = new TextEncoder();
  let closed = false;
  let interval: ReturnType<typeof setInterval>;

  const stream = new ReadableStream({
    start(controller) {
      function send(data: unknown) {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
          clearInterval(interval);
        }
      }

      function close() {
        if (closed) return;
        closed = true;
        clearInterval(interval);
        try { controller.close(); } catch {}
      }

      send(slimSnapshot(job));

      interval = setInterval(() => {
        const current = getEstateJob(jobId);
        if (!current) { close(); return; }
        send(slimSnapshot(current));
        if (current.status === "completed" || current.status === "cancelled" || current.status === "error") {
          close();
        }
      }, 500);
    },
    cancel() { closed = true; clearInterval(interval); },
  });

  request.signal.addEventListener("abort", () => { closed = true; clearInterval(interval); });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

/** Receive a result from the client-side browser */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params;
  const body = await request.json();
  const { rowIndex, estateStatus, fileNumber, sheetName, action } = body;

  const { getEstateJob, recordEstateResult, completeEstateScan } = await import("@/lib/estate-engine");
  const job = getEstateJob(jobId);
  if (!job) {
    return new Response(JSON.stringify({ error: "Job not found" }), { status: 404 });
  }

  if (action === "captcha_solved") {
    job.status = "running";
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }

  if (action === "update_current") {
    job.currentName = body.name || "";
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }

  if (action === "complete") {
    completeEstateScan(jobId);
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }

  if (action === "result") {
    await recordEstateResult(jobId, rowIndex, estateStatus, fileNumber || "", sheetName);
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }

  return new Response(JSON.stringify({ error: "Unknown action" }), { status: 400 });
}

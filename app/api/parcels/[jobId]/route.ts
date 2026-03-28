import { NextRequest } from "next/server";
import { getParcelJob } from "@/lib/parcel-engine";
import type { ParcelProgress } from "@/lib/types";

/** Send a lightweight snapshot — cap errors to keep SSE messages small */
function slimSnapshot(job: ParcelProgress) {
  return {
    jobId: job.jobId,
    status: job.status,
    total: job.total,
    processed: job.processed,
    succeeded: job.succeeded,
    failed: job.failed,
    currentAddress: job.currentAddress,
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
  const job = getParcelJob(jobId);

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
        try { controller.close(); } catch { /* already closed */ }
      }

      send(slimSnapshot(job));

      interval = setInterval(() => {
        const current = getParcelJob(jobId);
        if (!current) {
          close();
          return;
        }

        send(slimSnapshot(current));

        if (
          current.status === "completed" ||
          current.status === "cancelled" ||
          current.status === "error"
        ) {
          close();
        }
      }, 500);
    },
    cancel() {
      closed = true;
      clearInterval(interval);
    },
  });

  request.signal.addEventListener("abort", () => {
    closed = true;
    clearInterval(interval);
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

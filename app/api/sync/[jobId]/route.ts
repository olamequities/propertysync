import { NextRequest } from "next/server";
import { getJob } from "@/lib/sync-engine";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params;
  const job = getJob(jobId);

  if (!job) {
    return new Response(JSON.stringify({ error: "Job not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      let closed = false;

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

      // Send initial state immediately
      send(job);

      // Poll job progress every 500ms
      const interval = setInterval(() => {
        const current = getJob(jobId);
        if (!current) {
          close();
          return;
        }

        send(current);

        if (
          current.status === "completed" ||
          current.status === "cancelled" ||
          current.status === "error"
        ) {
          close();
        }
      }, 500);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

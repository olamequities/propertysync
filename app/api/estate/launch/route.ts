import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import path from "path";
import {
  getEstateJob,
  getActiveEstateJobId,
} from "@/lib/estate-engine";

export async function POST(request: NextRequest) {
  const jobId = getActiveEstateJobId();
  if (!jobId) {
    return NextResponse.json({ error: "No active estate job" }, { status: 400 });
  }

  const job = getEstateJob(jobId);
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const { sheetName, searches } = body;

  // Write searches to a temp file to avoid env var size limits
  const fs = await import("fs");
  const os = await import("os");
  const searchesFile = path.join(os.tmpdir(), `estate-searches-${jobId}.json`);
  fs.writeFileSync(searchesFile, JSON.stringify(searches || []));

  // Find Python executable — try py (Windows), python3, python
  const pyCommands = process.platform === "win32" ? ["py", "python3", "python"] : ["python3", "python"];

  const scriptPath = path.join(process.cwd(), "scripts", "estate-scanner.py");

  let launched = false;
  for (const pyCmd of pyCommands) {
    try {
      const child = spawn(pyCmd, [scriptPath], {
        env: {
          ...process.env,
          ESTATE_JOB_ID: jobId,
          ESTATE_SHEET_NAME: sheetName || "",
          ESTATE_SEARCHES_FILE: searchesFile,
          PORTAL_URL: `http://localhost:${process.env.PORT || 3000}`,
        },
        stdio: "pipe",
        detached: false,
        shell: true,
      });

      child.stdout?.on("data", (data) => {
        console.log(`[estate] ${data.toString().trim()}`);
      });

      child.stderr?.on("data", (data) => {
        console.error(`[estate:err] ${data.toString().trim()}`);
      });

      child.on("error", (err) => {
        console.error(`[estate] spawn error: ${err.message}`);
      });

      child.on("exit", (code) => {
        console.log(`[estate] Python exited with code ${code}`);
        const currentJob = getEstateJob(jobId);
        if (currentJob && currentJob.status !== "completed" && currentJob.status !== "cancelled") {
          currentJob.status = code === 0 ? "completed" : "error";
        }
        // Clear active ID
        const g = globalThis as unknown as { __estateActiveId?: string | null };
        if (g.__estateActiveId === jobId) g.__estateActiveId = null;
      });

      launched = true;
      console.log(`[estate] Launched with ${pyCmd}`);
      break;
    } catch {
      continue;
    }
  }

  if (!launched) {
    return NextResponse.json(
      { error: "Python not found. Install Python from the Microsoft Store." },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, jobId });
}

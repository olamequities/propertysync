import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import os from "os";
import {
  getEstateJob,
  getActiveEstateJobId,
} from "@/lib/estate-engine";

/** Find the estate scanner executable */
function findEstateScanner(): { cmd: string; args: string[] } | null {
  const cwd = process.cwd();
  console.log(`[estate] Looking for scanner. CWD: ${cwd}`);

  const names = ["estate-scanner.exe", "estate-scanner"];
  const candidates: string[] = [];

  for (const name of names) {
    // Production Electron: server runs from resources/app/flow/olam/olam-app/
    // Scanner is at resources/bin/
    // Walk up from CWD until we find a "bin" or "resources/bin" folder
    let dir = cwd;
    for (let i = 0; i < 8; i++) {
      candidates.push(path.join(dir, "bin", name));
      candidates.push(path.join(dir, "resources", "bin", name));
      dir = path.dirname(dir);
    }

    // Dev mode: electron/bin/
    candidates.push(path.join(cwd, "electron", "bin", name));

    // Electron resourcesPath
    const resPath = (process as unknown as Record<string, string>).resourcesPath || "";
    if (resPath) {
      candidates.push(path.join(resPath, "bin", name));
    }
  }

  for (const p of candidates) {
    if (fs.existsSync(p)) {
      console.log(`[estate] Found scanner at: ${p}`);
      return { cmd: p, args: [] };
    }
  }

  // Fallback: Python script (dev mode)
  const scriptPath = path.join(cwd, "scripts", "estate-scanner.py");
  if (fs.existsSync(scriptPath)) {
    const py = process.platform === "win32" ? "py" : "python3";
    console.log(`[estate] Falling back to Python: ${py} ${scriptPath}`);
    return { cmd: py, args: [scriptPath] };
  }

  console.log(`[estate] Scanner NOT found. Checked ${candidates.length} paths`);
  return null;
}

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

  // Write searches to a temp file
  const searchesFile = path.join(os.tmpdir(), `estate-searches-${jobId}.json`);
  fs.writeFileSync(searchesFile, JSON.stringify(searches || []));

  const scanner = findEstateScanner();
  console.log(`[estate] Scanner found: ${scanner ? `${scanner.cmd} ${scanner.args.join(" ")}` : "NOT FOUND"}`);
  console.log(`[estate] CWD: ${process.cwd()}`);
  console.log(`[estate] resourcesPath: ${(process as any).resourcesPath || "N/A"}`);

  if (!scanner) {
    return NextResponse.json(
      { error: "Estate scanner not found" },
      { status: 500 }
    );
  }

  try {
    const fullCmd = scanner.cmd;
    const fullArgs = [...scanner.args];
    console.log(`[estate] Spawning: "${fullCmd}" ${fullArgs.map(a => `"${a}"`).join(" ")}`);

    const child = spawn(fullCmd, fullArgs, {
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
      windowsHide: false,
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
      console.log(`[estate] Scanner exited with code ${code}`);
      const currentJob = getEstateJob(jobId);
      if (currentJob && currentJob.status !== "completed" && currentJob.status !== "cancelled") {
        currentJob.status = code === 0 ? "completed" : "error";
      }
      const g = globalThis as unknown as { __estateActiveId?: string | null };
      if (g.__estateActiveId === jobId) g.__estateActiveId = null;

      // Cleanup temp file
      try { fs.unlinkSync(searchesFile); } catch {}
    });

    console.log(`[estate] Launched: ${scanner.cmd} ${scanner.args.join(" ")}`);
    return NextResponse.json({ ok: true, jobId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to launch estate scanner";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

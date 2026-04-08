import { readAllRows, writeEstateResult } from "./google-sheets";

export interface EstateProgress {
  jobId: string;
  status: "waiting_captcha" | "running" | "completed" | "cancelled" | "error";
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  currentName: string;
  errors: { row: number; name: string; error: string }[];
  startedAt: number;
  lastCompletedRow?: {
    rowIndex: number;
    estateStatus: string;
    estateFileNumber: string;
  };
}

/** In-memory job store */
const g = globalThis as unknown as {
  __estateJobs?: Map<string, EstateProgress>;
  __estateActiveId?: string | null;
};

if (!g.__estateJobs) g.__estateJobs = new Map();
if (g.__estateActiveId === undefined) g.__estateActiveId = null;

const jobs = g.__estateJobs;

export function getEstateJob(jobId: string): EstateProgress | undefined {
  return jobs.get(jobId);
}

export function isEstateRunning(): boolean {
  return g.__estateActiveId !== null;
}

export function getActiveEstateJobId(): string | null {
  return g.__estateActiveId ?? null;
}

export function cancelEstateJob(jobId: string): boolean {
  const job = jobs.get(jobId);
  if (!job) return false;
  job.status = "cancelled";
  if (g.__estateActiveId === jobId) g.__estateActiveId = null;
  return true;
}

export interface EstateScanOptions {
  sheetName?: string;
}

const BOROUGH_TO_COURT: Record<string, string> = {
  bronx: "3", brooklyn: "24", kings: "24",
  manhattan: "31", "new york": "31",
  queens: "41", "staten island": "43", richmond: "43",
};

/**
 * Start an estate scan. This runs searches against surrogate court.
 * Since it needs a real browser, it requires the user to solve hCaptcha first.
 * The scan uses a fetch-based approach after session is established.
 *
 * For now, this runs server-side — on the desktop Electron app, the browser
 * session is from the user's machine so surrogate court works.
 */
export function startEstateScan(options: EstateScanOptions = {}): string {
  if (isEstateRunning()) throw new Error("An estate scan is already running");

  const jobId = crypto.randomUUID();

  const progress: EstateProgress = {
    jobId,
    status: "waiting_captcha",
    total: 0,
    processed: 0,
    succeeded: 0,
    failed: 0,
    currentName: "",
    errors: [],
    startedAt: Date.now(),
  };

  jobs.set(jobId, progress);
  g.__estateActiveId = jobId;

  // The estate scan will be driven by the client-side browser.
  // The API provides the list of names to search and receives results.
  // See /api/estate/ routes.

  return jobId;
}

/** Get the list of GOOD_LEAD rows that need estate checking */
export async function getEstateSearchList(sheetName?: string): Promise<Array<{
  rowIndex: number;
  lastName: string;
  firstName: string;
  courtId: string;
  owner: string;
  borough: string;
}>> {
  const allRows = await readAllRows(sheetName);
  const goodLeads = allRows.filter(
    (r) => r.parcelStatus === "GOOD_LEAD" && !r.estateStatus
  );

  return goodLeads.map((r) => {
    let lastName = "";
    let firstName = "";

    if (r.ownerName.includes(",")) {
      // "LIRIANO, MARIA N" → last=LIRIANO, first=MARIA
      const parts = r.ownerName.split(",", 2);
      lastName = parts[0]?.trim() || "";
      // Take only the first word of the first name (drop middle initial)
      const firstParts = (parts[1]?.trim() || "").split(/\s+/);
      firstName = firstParts[0] || "";
    } else {
      // No comma — filter out single-letter initials AND name suffixes
      const suffixes = new Set(["JR", "SR", "II", "III", "IV", "ESQ"]);
      const words = r.ownerName.trim().split(/\s+/);
      const meaningful = words.filter(w => w.length > 1 && !suffixes.has(w.toUpperCase()));
      if (meaningful.length >= 2) {
        firstName = meaningful[0];
        lastName = meaningful[meaningful.length - 1];
      } else if (meaningful.length === 1) {
        lastName = meaningful[0];
      } else if (words.length >= 2) {
        firstName = words[0];
        lastName = words[words.length - 1];
      } else {
        lastName = r.ownerName.trim();
      }
    }

    const courtId = BOROUGH_TO_COURT[r.borough.toLowerCase().trim()] || "3";

    return {
      rowIndex: r.rowIndex,
      lastName,
      firstName,
      courtId,
      owner: r.ownerName,
      borough: r.borough,
    };
  });
}

/** Record a single estate result */
export async function recordEstateResult(
  jobId: string,
  rowIndex: number,
  estateStatus: string,
  fileNumber: string,
  sheetName?: string
): Promise<void> {
  const job = jobs.get(jobId);
  if (!job) {
    console.error(`[estate] recordEstateResult: job ${jobId} not found`);
    return;
  }

  try {
    await writeEstateResult(rowIndex, estateStatus, fileNumber, sheetName);
  } catch (err) {
    console.error(`[estate] Failed to write estate result for row ${rowIndex}:`, err);
  }

  job.processed++;
  if (estateStatus === "YES") {
    job.succeeded++;
  } else if (estateStatus === "ERROR") {
    job.failed++;
  }
  job.lastCompletedRow = { rowIndex, estateStatus, estateFileNumber: fileNumber };
}

/** Mark estate scan as complete */
export function completeEstateScan(jobId: string): void {
  const job = jobs.get(jobId);
  if (job && job.status !== "cancelled" && job.status !== "error") {
    job.status = "completed";
    job.currentName = "";
  }
  if (g.__estateActiveId === jobId) g.__estateActiveId = null;
}

/** Cleanup old jobs to prevent memory leak */
export function cleanupOldJobs(): void {
  const MAX_AGE = 24 * 60 * 60 * 1000; // 24 hours
  const now = Date.now();
  for (const [jobId, job] of jobs.entries()) {
    if (now - job.startedAt > MAX_AGE && job.status !== "running" && job.status !== "waiting_captcha") {
      jobs.delete(jobId);
    }
  }
}

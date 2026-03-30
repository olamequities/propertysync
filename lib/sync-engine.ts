import { NYCPropertyScraper } from "./scraper";
import { readAllRows, writeSyncResult } from "./google-sheets";
import type { SyncProgress } from "./types";

/** In-memory job store — attached to globalThis to survive Next.js dev hot reloads */
const g = globalThis as unknown as {
  __syncJobs?: Map<string, SyncProgress>;
  __syncAbort?: Map<string, AbortController>;
  __syncPause?: Map<string, { paused: boolean; resolve: (() => void) | null }>;
  __syncActiveId?: string | null;
};

if (!g.__syncJobs) g.__syncJobs = new Map();
if (!g.__syncAbort) g.__syncAbort = new Map();
if (!g.__syncPause) g.__syncPause = new Map();
if (g.__syncActiveId === undefined) g.__syncActiveId = null;

const jobs = g.__syncJobs;
const abortControllers = g.__syncAbort;
const pauseControllers = g.__syncPause;

function getActiveSyncId() { return g.__syncActiveId ?? null; }
function setActiveSyncId(id: string | null) { g.__syncActiveId = id; }

export function getJob(jobId: string): SyncProgress | undefined {
  return jobs.get(jobId);
}

export function isRunning(): boolean {
  return getActiveSyncId() !== null;
}

export function getActiveJobId(): string | null {
  return getActiveSyncId();
}

export function pauseJob(jobId: string): boolean {
  const job = jobs.get(jobId);
  if (!job || job.status !== "running") return false;
  job.status = "paused";
  pauseControllers.set(jobId, { paused: true, resolve: null });
  return true;
}

export function resumeJob(jobId: string): boolean {
  const job = jobs.get(jobId);
  if (!job || job.status !== "paused") return false;
  job.status = "running";
  const ctrl = pauseControllers.get(jobId);
  if (ctrl?.resolve) ctrl.resolve();
  pauseControllers.delete(jobId);
  return true;
}

export function cancelJob(jobId: string): boolean {
  const controller = abortControllers.get(jobId);
  if (!controller) return false;
  // If paused, unblock first so the abort can propagate
  const pause = pauseControllers.get(jobId);
  if (pause?.resolve) pause.resolve();
  pauseControllers.delete(jobId);
  controller.abort();
  const job = jobs.get(jobId);
  if (job) job.status = "cancelled";
  if (getActiveSyncId() === jobId) setActiveSyncId(null);
  return true;
}

function waitIfPaused(jobId: string): Promise<void> {
  const ctrl = pauseControllers.get(jobId);
  if (!ctrl?.paused) return Promise.resolve();
  return new Promise((resolve) => { ctrl.resolve = resolve; });
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    });
  });
}

/** Send webhook notification to Zapier when sync completes */
async function sendWebhook(progress: SyncProgress) {
  const url = process.env.ZAPIER_WEBHOOK_URL;
  if (!url) return;

  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: "sync_complete",
        jobId: progress.jobId,
        status: progress.status,
        total: progress.total,
        processed: progress.processed,
        succeeded: progress.succeeded,
        failed: progress.failed,
        errors: progress.errors,
        durationMs: Date.now() - progress.startedAt,
      }),
    });
  } catch (err) {
    console.error("Webhook delivery failed:", err);
  }
}

export interface SyncOptions {
  sheetName?: string;
  startRow?: number; // 1-based data row (excluding header), e.g. 1 = first data row
  endRow?: number;   // inclusive
}

/** Start a background sync. Returns immediately with the jobId. */
export function startSync(options: SyncOptions = {}): string {
  if (getActiveSyncId()) throw new Error("A sync is already running");
  // Lazy import to avoid circular dependency
  const { isParcelRunning } = require("./parcel-engine");
  if (isParcelRunning()) throw new Error("A parcel scan is currently running");

  const jobId = crypto.randomUUID();
  const controller = new AbortController();

  const progress: SyncProgress = {
    jobId,
    status: "running",
    total: 0,
    processed: 0,
    succeeded: 0,
    failed: 0,
    currentAddress: "",
    errors: [],
    startedAt: Date.now(),
  };

  jobs.set(jobId, progress);
  abortControllers.set(jobId, controller);
  setActiveSyncId(jobId);

  // Fire and forget - the sync runs in the background
  runSync(progress, controller.signal, options).catch((err) => {
    if (progress.status !== "cancelled") {
      console.error("Sync engine error:", err);
      progress.status = "error";
    }
  }).finally(() => {
    if (getActiveSyncId() === jobId) setActiveSyncId(null);
    abortControllers.delete(jobId);
    sendWebhook(progress);
  });

  return jobId;
}

async function runSync(progress: SyncProgress, signal: AbortSignal, options: SyncOptions) {
  const delay = parseInt(process.env.SCRAPER_DELAY_MS ?? "1000", 10);
  const defaultBorough = process.env.SCRAPER_BOROUGH ?? "3";

  const boroughMap: Record<string, string> = {
    manhattan: "1", bronx: "2", brooklyn: "3", queens: "4", "staten island": "5",
    "1": "1", "2": "2", "3": "3", "4": "4", "5": "5",
  };

  // Read all rows, filter to empty ones
  const allRows = await readAllRows(options.sheetName);
  console.log(`[sync] Read ${allRows.length} rows from sheet "${options.sheetName}"`);

  // Apply row range filter if specified (startRow/endRow are 1-based data indices)
  let targetRows = allRows;
  if (options.startRow || options.endRow) {
    const start = options.startRow ? options.startRow + 1 : 2; // convert to sheet rowIndex
    const end = options.endRow ? options.endRow + 1 : Infinity;
    targetRows = allRows.filter((r) => r.rowIndex >= start && r.rowIndex <= end);
    console.log(`[sync] Filtered to ${targetRows.length} rows (range ${start}-${end})`);
  }

  const emptyRows = targetRows.filter((r) => !r.processed);
  progress.total = emptyRows.length;
  console.log(`[sync] Found ${emptyRows.length} empty rows to process`);

  for (const row of emptyRows) {
    await waitIfPaused(progress.jobId);
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");

    const street = row.street.replace(/\s*#\s*\d+.*$/, ""); // Remove apt/unit
    const address = `${row.houseNumber} ${street}`;
    progress.currentAddress = address;

    try {
      const scraper = new NYCPropertyScraper(signal);
      const data = await scraper.getPropertyDataByAddress(
        row.houseNumber,
        street,
        boroughMap[row.borough.toLowerCase().trim()] || defaultBorough
      );

      const ownerName = data.owner_name ?? "";
      const billing = data.billing_name ?? "";

      await writeSyncResult(row.rowIndex, ownerName, billing, data.block || "", data.lot || "", options.sheetName);
      progress.succeeded++;
      progress.lastCompletedRow = {
        rowIndex: row.rowIndex,
        ownerName,
        billingNameAndAddress: billing,
      };
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") throw err;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[sync] Row ${row.rowIndex} (${address}) failed:`, msg);
      progress.errors.push({ row: row.rowIndex, address, error: msg });
      progress.failed++;
    }

    progress.processed++;
    await waitIfPaused(progress.jobId);
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    await sleep(delay, signal);
  }

  progress.status = "completed";
  progress.currentAddress = "";
}

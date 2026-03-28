import { readAllRows, writeParcelResult, writeBlockLot } from "./google-sheets";
import { searchACRIS, analyzeDocuments, ACRIS_MIN_DELAY } from "./acris-scraper";
import { NYCPropertyScraper } from "./scraper";
import type { ParcelProgress } from "./types";

/** In-memory job store — attached to globalThis to survive Next.js dev hot reloads */
const g = globalThis as unknown as {
  __parcelJobs?: Map<string, ParcelProgress>;
  __parcelAbort?: Map<string, AbortController>;
  __parcelPause?: Map<string, { paused: boolean; resolve: (() => void) | null }>;
  __parcelActiveId?: string | null;
};

if (!g.__parcelJobs) g.__parcelJobs = new Map();
if (!g.__parcelAbort) g.__parcelAbort = new Map();
if (!g.__parcelPause) g.__parcelPause = new Map();
if (g.__parcelActiveId === undefined) g.__parcelActiveId = null;

const jobs = g.__parcelJobs;
const abortControllers = g.__parcelAbort;
const pauseControllers = g.__parcelPause;

function getActiveParcelId() { return g.__parcelActiveId ?? null; }
function setActiveParcelId(id: string | null) { g.__parcelActiveId = id; }

export function getParcelJob(jobId: string): ParcelProgress | undefined {
  return jobs.get(jobId);
}

export function isParcelRunning(): boolean {
  return getActiveParcelId() !== null;
}

export function getActiveParcelJobId(): string | null {
  return getActiveParcelId();
}

export function pauseParcelJob(jobId: string): boolean {
  const job = jobs.get(jobId);
  if (!job || job.status !== "running") return false;
  job.status = "paused";
  pauseControllers.set(jobId, { paused: true, resolve: null });
  return true;
}

export function resumeParcelJob(jobId: string): boolean {
  const job = jobs.get(jobId);
  if (!job || job.status !== "paused") return false;
  job.status = "running";
  const ctrl = pauseControllers.get(jobId);
  if (ctrl?.resolve) ctrl.resolve();
  pauseControllers.delete(jobId);
  return true;
}

export function cancelParcelJob(jobId: string): boolean {
  const controller = abortControllers.get(jobId);
  if (!controller) return false;
  const pause = pauseControllers.get(jobId);
  if (pause?.resolve) pause.resolve();
  pauseControllers.delete(jobId);
  controller.abort();
  const job = jobs.get(jobId);
  if (job) job.status = "cancelled";
  if (getActiveParcelId() === jobId) setActiveParcelId(null);
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

export interface ParcelScanOptions {
  sheetName?: string;
}

const BOROUGH_MAP: Record<string, string> = {
  manhattan: "1", bronx: "2", brooklyn: "3", queens: "4", "staten island": "5",
  "1": "1", "2": "2", "3": "3", "4": "4", "5": "5",
};

/** Start a background parcel scan. Returns immediately with the jobId. */
export function startParcelScan(options: ParcelScanOptions = {}): string {
  if (getActiveParcelId()) throw new Error("A parcel scan is already running");

  // Lazy import to avoid circular dependency at module load time
  const { isRunning: isSyncRunning } = require("./sync-engine");
  if (isSyncRunning()) throw new Error("A sync is currently running");

  const jobId = crypto.randomUUID();
  const controller = new AbortController();

  const progress: ParcelProgress = {
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
  setActiveParcelId(jobId);

  runParcelScan(progress, controller.signal, options).catch((err) => {
    if (progress.status !== "cancelled") {
      console.error("Parcel engine error:", err);
      progress.status = "error";
    }
  }).finally(() => {
    if (getActiveParcelId() === jobId) setActiveParcelId(null);
    abortControllers.delete(jobId);
  });

  return jobId;
}

async function runParcelScan(progress: ParcelProgress, signal: AbortSignal, options: ParcelScanOptions) {
  const delay = Math.max(ACRIS_MIN_DELAY, parseInt(process.env.SCRAPER_DELAY_MS ?? "5000", 10));
  const defaultBorough = process.env.SCRAPER_BOROUGH ?? "3";

  const allRows = await readAllRows(options.sheetName);
  console.log(`[parcel] Read ${allRows.length} rows from sheet`);

  // Filter to rows that have no parcelStatus and have enough address info
  const pendingRows = allRows.filter((r) => !r.parcelStatus && (r.houseNumber && r.street));
  progress.total = pendingRows.length;
  console.log(`[parcel] Found ${pendingRows.length} rows to scan`);

  for (const row of pendingRows) {
    await waitIfPaused(progress.jobId);
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");

    const address = row.fullAddress || `${row.houseNumber} ${row.street}`;
    progress.currentAddress = address;

    try {
      const boroughCode = BOROUGH_MAP[row.borough.toLowerCase().trim()] || defaultBorough;
      let { block, lot } = row;

      // Look up block/lot from NYC property site if missing
      if (!block || !lot) {
        console.log(`[parcel] Block/lot missing for ${address}, looking up via scraper...`);
        const scraper = new NYCPropertyScraper(signal);
        const street = row.street.replace(/\s*#\s*\d+.*$/, "");
        const data = await scraper.getPropertyDataByAddress(row.houseNumber, street, boroughCode);
        if (data.block && data.lot) {
          block = data.block;
          lot = data.lot;
          await writeBlockLot(row.rowIndex, block, lot, options.sheetName);
          console.log(`[parcel] Found block=${block} lot=${lot} for ${address}`);
        } else {
          throw new Error("Could not determine block/lot from NYC property site");
        }
      }

      console.log(`[parcel] Searching ACRIS for ${address} (B:${boroughCode} Bl:${block} L:${lot})`);
      const docs = await searchACRIS(boroughCode, block, lot, signal);
      console.log(`[parcel] ${address}: got ${docs.length} docs from ACRIS`);
      const mortgages = docs.filter(d => d.docType === "MORTGAGE");
      const deeds = docs.filter(d => d.docType === "DEED");
      console.log(`[parcel] ${address}: ${mortgages.length} mortgages, ${deeds.length} deeds`);
      if (mortgages.length > 0) {
        mortgages.forEach(m => console.log(`[parcel]   MORTGAGE: ${m.party1} -> ${m.party2} $${m.amount} on ${m.docDate}`));
      }

      const analysis = analyzeDocuments(docs, row.ownerName || null);
      console.log(`[parcel] ${address}: reverseMortgage=${analysis.reverseMortgage.detected}, hasBeenSold=${analysis.hasBeenSold}, isGoodLead=${analysis.isGoodLead}`);

      let parcelStatus: string;
      if (analysis.isGoodLead) {
        parcelStatus = "GOOD_LEAD";
      } else if (analysis.hasBeenSold) {
        parcelStatus = "SOLD";
      } else if (!analysis.reverseMortgage.detected) {
        parcelStatus = "NO_REVERSE_MORTGAGE";
      } else {
        // Reverse mortgage detected but satisfied
        parcelStatus = "SATISFIED";
      }

      const parcelDetails = analysis.reasons.join(" | ");

      await writeParcelResult(row.rowIndex, parcelStatus, parcelDetails, options.sheetName);
      progress.succeeded++;
      progress.lastCompletedRow = {
        rowIndex: row.rowIndex,
        parcelStatus,
        parcelDetails,
      };
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") throw err;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[parcel] Row ${row.rowIndex} (${address}) failed:`, msg);
      progress.errors.push({ row: row.rowIndex, address, error: msg });
      progress.failed++;

      // Write ERROR status to sheet so it doesn't get retried
      try {
        await writeParcelResult(row.rowIndex, "ERROR", msg, options.sheetName);
        progress.lastCompletedRow = {
          rowIndex: row.rowIndex,
          parcelStatus: "ERROR",
          parcelDetails: msg,
        };
      } catch {
        // ignore write failure
      }
    }

    progress.processed++;
    await waitIfPaused(progress.jobId);
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    await sleep(delay, signal);
  }

  progress.status = "completed";
  progress.currentAddress = "";
}

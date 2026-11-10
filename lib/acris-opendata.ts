/**
 * ACRIS Open Data API (SODA) — replaces the ACRIS website scraper.
 * Uses NYC Open Data REST API: no rate limits, no cookies, no bandwidth pages.
 * Docs: https://dev.socrata.com/docs/queries/
 */

const SODA_BASE = "https://data.cityofnewyork.us/resource";
const LEGALS = "8h5j-fqxa";
const MASTER = "bnx9-e6tj";
const PARTIES = "636b-3b5g";

// Optional app token for higher rate limits (1000 req/hr without, unlimited with)
const APP_TOKEN = process.env.NYC_OPENDATA_APP_TOKEN || "";

/** NYC Open Data is down or overloaded (5xx, 429, timeout, network) — worth retrying later */
export class SodaUnavailableError extends Error {}

const SODA_TIMEOUT_MS = 60_000;
const SODA_RETRY_DELAYS_MS = [5_000, 15_000, 45_000];

async function sodaFetch(dataset: string, params: string, limit = 500, signal?: AbortSignal): Promise<any[]> {
  const tokenParam = APP_TOKEN ? `&$$app_token=${APP_TOKEN}` : "";
  const url = `${SODA_BASE}/${dataset}.json?${params}&$limit=${limit}${tokenParam}`;

  for (let attempt = 0; ; attempt++) {
    let error: Error;
    try {
      const timeout = AbortSignal.timeout(SODA_TIMEOUT_MS);
      const resp = await fetch(url, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
      if (resp.ok) return resp.json();
      const body = (await resp.text()).slice(0, 200);
      if (resp.status !== 429 && resp.status < 500) throw new Error(`SODA API ${resp.status}: ${body}`);
      error = new SodaUnavailableError(`NYC Open Data unavailable (HTTP ${resp.status})`);
    } catch (err) {
      if (signal?.aborted) throw err;
      if (!(err instanceof Error) || err.message.startsWith("SODA API")) throw err;
      error = err instanceof SodaUnavailableError
        ? err
        : new SodaUnavailableError(`NYC Open Data unavailable (${err.name === "TimeoutError" ? "timed out" : err.message})`);
    }

    if (attempt >= SODA_RETRY_DELAYS_MS.length) throw error;
    console.warn(`[acris-opendata] ${error.message} — retrying in ${SODA_RETRY_DELAYS_MS[attempt] / 1000}s`);
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(resolve, SODA_RETRY_DELAYS_MS[attempt]);
      signal?.addEventListener("abort", () => { clearTimeout(t); reject(new DOMException("Aborted", "AbortError")); }, { once: true });
    });
  }
}

// Re-export ACRISDocument so callers don't need to import from acris-scraper
export interface ACRISDocument {
  crfn: string;
  lot: string;
  partial: string;
  docDate: string;
  recorded: string;
  docType: string;
  pages: string;
  party1: string;
  party2: string;
  amount: string;
  docId: string;
}

/** Search ACRIS via NYC Open Data API by Borough/Block/Lot */
export async function searchACRIS(borough: string, block: string, lot: string, signal?: AbortSignal): Promise<ACRISDocument[]> {
  // Step 1: Find all document IDs for this property
  const where = `borough=${borough} AND block=${block} AND lot=${lot}`;
  const legals = await sodaFetch(LEGALS, `$where=${encodeURIComponent(where)}`, 500, signal);

  if (legals.length === 0) return [];

  const docIds = [...new Set(legals.map((l: any) => l.document_id))] as string[];
  console.log(`[acris-opendata] Found ${docIds.length} documents for B:${borough} Bl:${block} L:${lot}`);

  // Step 2: Batch fetch masters and parties (batch 30 at a time to stay within URL limits)
  const allMasters: any[] = [];
  const allParties: any[] = [];

  for (let i = 0; i < docIds.length; i += 30) {
    const batch = docIds.slice(i, i + 30);
    const idList = batch.map(id => `'${id}'`).join(",");
    const whereClause = encodeURIComponent(`document_id in(${idList})`);

    const [masters, parties] = await Promise.all([
      sodaFetch(MASTER, `$where=${whereClause}`, 500, signal),
      sodaFetch(PARTIES, `$where=${whereClause}`, 1000, signal),
    ]);

    allMasters.push(...masters);
    allParties.push(...parties);
  }

  // Step 3: Build ACRISDocument[] matching the shape used by analyzeDocuments
  const docs: ACRISDocument[] = [];

  for (const m of allMasters) {
    const p1Names = allParties
      .filter((p: any) => p.document_id === m.document_id && String(p.party_type) === "1")
      .map((p: any) => p.name)
      .join(",");

    const p2Names = allParties
      .filter((p: any) => p.document_id === m.document_id && String(p.party_type) === "2")
      .map((p: any) => p.name)
      .join(",");

    const rawDate = m.document_date || "";
    const dateStr = rawDate ? rawDate.split("T")[0] : "";

    const rawRecorded = m.recorded_datetime || "";
    const recordedStr = rawRecorded ? rawRecorded.split("T")[0] : "";

    docs.push({
      crfn: m.crfn || "",
      lot: lot,
      partial: "",
      docDate: dateStr,
      recorded: recordedStr,
      docType: mapDocType(m.doc_type),
      pages: "",
      party1: p1Names,
      party2: p2Names,
      amount: m.document_amt || "0",
      docId: m.document_id,
    });
  }

  return docs;
}

/** Map SODA doc_type codes to the full names used by analyzeDocuments */
function mapDocType(code: string): string {
  const map: Record<string, string> = {
    "MTGE": "MORTGAGE",
    "M&CON": "MORTGAGE",
    "SAT": "SATISFACTION OF MORTGAGE",
    "SATIS": "SATISFACTION OF MORTGAGE",
    "DEED": "DEED",
    "DEEDO": "DEED",
    "DEED, TS": "DEED",
    "DEED, OTHER": "DEED",
    "ASST": "ASSIGNMENT, MORTGAGE",
    "ASPM": "ASSIGNMENT, MORTGAGE",
    "AGMT": "AGREEMENT",
  };
  return map[code] || code;
}

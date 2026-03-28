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

async function sodaFetch(dataset: string, params: string, limit = 500, signal?: AbortSignal): Promise<any[]> {
  const tokenParam = APP_TOKEN ? `&$$app_token=${APP_TOKEN}` : "";
  const url = `${SODA_BASE}/${dataset}.json?${params}&$limit=${limit}${tokenParam}`;
  const resp = await fetch(url, { signal });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`SODA API ${resp.status}: ${body}`);
  }
  return resp.json();
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
export async function searchACRIS(borough: string, block: string, lot: string, signal?: AbortSignal): Promise<OpenDataDocument[]> {
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

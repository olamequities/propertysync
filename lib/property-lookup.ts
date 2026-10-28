import { NYCPropertyScraper, extractHouseNumber, houseNumberMatches } from "./scraper";
import type { PropertyData } from "./types";

/** NYC Planning GeoSearch — free, no key. Normalizes addresses ("E 56Th St", "18822 Dormans Rd") to a BBL. */
const GEOSEARCH_URL = "https://geosearch.planninglabs.nyc/v2/search";

/** Error for addresses that can't be matched — shown to the user as-is, never retried via fallback */
export class AddressError extends Error {}

const BOROUGH_CODES: Record<string, string> = {
  manhattan: "1", "new york": "1",
  bronx: "2",
  brooklyn: "3", kings: "3",
  queens: "4",
  "staten island": "5", richmond: "5",
  "1": "1", "2": "2", "3": "3", "4": "4", "5": "5",
};

const BOROUGH_NAMES: Record<string, string> = {
  "1": "Manhattan", "2": "Bronx", "3": "Brooklyn", "4": "Queens", "5": "Staten Island",
};

/** Map a sheet borough/county value to a NYC borough code (1–5). Empty → fallback; non-NYC → AddressError. */
export function resolveBoroughCode(raw: string, fallback: string): string {
  const key = raw.toLowerCase().replace(/\s+county$/, "").trim();
  if (!key) return fallback;
  const code = BOROUGH_CODES[key];
  if (!code) throw new AddressError(`"${raw}" is outside NYC — not in the NYC property database`);
  return code;
}

/** Guard against shifted columns: House Number + Street (B/C) must match the start of Full Address (A) */
export function assertAddressColumnsMatch(fullAddress: string, houseNumber: string, street: string): void {
  if (!fullAddress) return;
  const norm = (s: string) => s.toUpperCase().replace(/[^0-9A-Z]/g, "");
  if (norm(fullAddress.split(",")[0]) !== norm(`${houseNumber} ${street}`)) {
    throw new AddressError(`House Number/Street "${houseNumber} ${street}" don't match Full Address "${fullAddress}"`);
  }
}

/** "1895 A" / "188-22" / "188 -22" → "1895A" / "18822" for comparison */
function normalizeHouseNumber(s: string): string {
  return s.toUpperCase().replace(/[^0-9A-Z]/g, "");
}

interface ResolvedBBL {
  borough: string;
  block: string;
  lot: string;
  street: string; // normalized, e.g. "EAST 56 STREET", "DORMANS ROAD"
}

/** Resolve an address to Borough/Block/Lot, verifying the match is the same house in the same borough */
async function resolveBBL(
  houseNumber: string,
  street: string,
  boroughCode: string,
  signal?: AbortSignal
): Promise<ResolvedBBL> {
  const text = `${houseNumber} ${street}, ${BOROUGH_NAMES[boroughCode]}, NY`;
  const resp = await fetch(`${GEOSEARCH_URL}?size=1&text=${encodeURIComponent(text)}`, { signal });
  if (!resp.ok) throw new Error(`GeoSearch HTTP ${resp.status}`);
  const json = await resp.json();

  const props = json.features?.[0]?.properties;
  const bbl: string | undefined = props?.addendum?.pad?.bbl;
  if (!props || !bbl || bbl.length !== 10) {
    throw new AddressError("Address not found in NYC address database");
  }

  // GeoSearch falls back to the closest address anywhere in NYC — reject anything that isn't this exact house
  const matchedBorough = BOROUGH_CODES[(props.borough ?? "").toLowerCase()];
  if (matchedBorough !== boroughCode || normalizeHouseNumber(props.housenumber ?? "") !== normalizeHouseNumber(houseNumber)) {
    throw new AddressError(`Address not found in ${BOROUGH_NAMES[boroughCode]} (closest match: ${props.label})`);
  }

  return {
    borough: bbl.slice(0, 1),
    block: String(parseInt(bbl.slice(1, 6), 10)),
    lot: String(parseInt(bbl.slice(6, 10), 10)),
    street: props.street ?? "",
  };
}

/** Queens house numbers are hyphenated on the NYC property site: "18822" → "188-22" */
function houseNumberCandidates(houseNumber: string, boroughCode: string): string[] {
  const candidates = [houseNumber];
  if (boroughCode === "4" && /^\d{3,}[A-Z]?$/i.test(houseNumber)) {
    const digits = houseNumber.match(/^\d+/)![0];
    candidates.push(`${digits.slice(0, -2)}-${digits.slice(-2)}${houseNumber.slice(digits.length)}`);
  }
  return candidates;
}

/** NYC property site address search, exact house number only (tries Queens hyphenation) */
async function lookupByAddress(
  houseNumber: string,
  street: string,
  boroughCode: string,
  signal?: AbortSignal
): Promise<PropertyData> {
  let lastErr: unknown;
  for (const candidate of houseNumberCandidates(houseNumber, boroughCode)) {
    try {
      return await new NYCPropertyScraper(signal).getPropertyDataByAddress(candidate, street, boroughCode);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") throw err;
      lastErr = err;
    }
  }
  throw lastErr;
}

/**
 * Look up owner/billing data for an address.
 * Primary path: GeoSearch → BBL → NYC property site BBL search, verified to be the same house number.
 * GeoSearch lots can cover a range of addresses or a corner (e.g. 230 Sumpter → 228 Sumpter's lot), so on a
 * house number mismatch — or if GeoSearch is unreachable — fall back to an exact-match address search.
 */
export async function lookupProperty(
  houseNumber: string,
  street: string,
  boroughCode: string,
  signal?: AbortSignal
): Promise<PropertyData> {
  let bbl: ResolvedBBL;
  try {
    bbl = await resolveBBL(houseNumber, street, boroughCode, signal);
  } catch (err) {
    if (err instanceof AddressError) throw err;
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    console.warn(`[lookup] GeoSearch failed for ${houseNumber} ${street}, using address search:`, err instanceof Error ? err.message : err);
    return lookupByAddress(houseNumber, street, boroughCode, signal);
  }

  const data = await new NYCPropertyScraper(signal).getPropertyDataByBBL(bbl.borough, bbl.block, bbl.lot);
  if (data.address && houseNumberMatches(extractHouseNumber(data.address), houseNumber)) return data;

  console.log(`[lookup] ${houseNumber} ${street}: lot ${bbl.block}/${bbl.lot} is "${data.address}", searching by address`);
  return lookupByAddress(houseNumber, bbl.street || street, boroughCode, signal);
}

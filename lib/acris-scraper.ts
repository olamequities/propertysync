import * as cheerio from "cheerio";

const BASE = "https://a836-acris.nyc.gov";

const HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Upgrade-Insecure-Requests": "1",
};

class CookieJar {
  private cookies = new Map<string, string>();
  absorb(response: Response) {
    const setCookies = response.headers.getSetCookie?.() ?? [];
    for (const sc of setCookies) {
      const parts = sc.split(";")[0];
      const eqIdx = parts.indexOf("=");
      if (eqIdx > 0) {
        this.cookies.set(parts.slice(0, eqIdx).trim(), parts.slice(eqIdx + 1).trim());
      }
    }
  }
  toString(): string {
    return Array.from(this.cookies.entries()).map(([k, v]) => `${k}=${v}`).join("; ");
  }
}

async function fetchWithJar(jar: CookieJar, method: string, url: string, body?: string, signal?: AbortSignal) {
  let currentUrl = url;
  let currentBody = body;
  let currentMethod = method;

  for (let i = 0; i < 10; i++) {
    const resp = await fetch(currentUrl, {
      method: currentMethod,
      headers: {
        ...HEADERS,
        Cookie: jar.toString(),
        ...(currentMethod === "POST" ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      },
      body: currentMethod === "POST" ? currentBody : undefined,
      redirect: "manual",
      signal,
    });
    jar.absorb(resp);

    if (resp.status >= 300 && resp.status < 400) {
      const location = resp.headers.get("location");
      if (location) {
        currentUrl = location.startsWith("http") ? location : new URL(location, currentUrl).href;
        currentMethod = "GET";
        currentBody = undefined;
        continue;
      }
    }

    return { text: await resp.text(), status: resp.status, url: currentUrl };
  }
  throw new Error("Too many redirects");
}

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

export interface ReverseMortgageInfo {
  detected: boolean;
  borrower: string | null;
  date: string | null;
  amount: string | null;
  lender: string | null;
  docs: ACRISDocument[];
}

export interface DocumentAnalysis {
  mortgages: ACRISDocument[];
  satisfactions: ACRISDocument[];
  deeds: ACRISDocument[];
  assignments: ACRISDocument[];
  reverseMortgage: ReverseMortgageInfo;
  activeMortgageCount: number;
  hasBeenSold: boolean;
  lastDeed: ACRISDocument | null;
  isGoodLead: boolean;
  reasons: string[];
}

/** HUD / Secretary of Housing keywords */
const HUD_KEYWORDS = [
  "hud", "housing and urban", "housing & urban", "secretary of h",
];

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z]/g, "");
}

/** Check if two names match, handling "LAST, FIRST" vs "FIRST LAST" ordering */
function namesMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  const aNorm = normalizeName(a);
  const bNorm = normalizeName(b);
  // Direct substring match
  if (aNorm.includes(bNorm) || bNorm.includes(aNorm)) return true;
  // Split into parts and check if all parts of one appear in the other
  const aParts = a.toLowerCase().replace(/[^a-z\s]/g, "").split(/\s+/).filter(p => p.length > 2);
  const bParts = b.toLowerCase().replace(/[^a-z\s]/g, "").split(/\s+/).filter(p => p.length > 2);
  if (aParts.length === 0 || bParts.length === 0) return false;
  const aInB = aParts.every(p => bParts.some(bp => bp.includes(p) || p.includes(bp)));
  const bInA = bParts.every(p => aParts.some(ap => ap.includes(p) || p.includes(ap)));
  return aInB || bInA;
}

function isHudParty(party: string): boolean {
  const lower = party.toLowerCase();
  return HUD_KEYWORDS.some(kw => lower.includes(kw));
}

function isPrivateLender(party: string): boolean {
  return !isHudParty(party);
}

/** Find the original borrower — the party1 on the earliest mortgage */
function findOriginalBorrower(mortgages: ACRISDocument[]): string | null {
  if (mortgages.length === 0) return null;
  const sorted = [...mortgages].sort((a, b) => {
    const dateA = a.docDate ? new Date(a.docDate).getTime() : 0;
    const dateB = b.docDate ? new Date(b.docDate).getTime() : 0;
    return dateA - dateB;
  });
  return sorted[0].party1;
}

/**
 * Detect reverse mortgage pattern (strict rules from client):
 *
 * A true reverse mortgage ALWAYS has:
 * 1. Two MORTGAGE docs on the SAME DATE for the SAME AMOUNT
 * 2. One from a private bank, one from Secretary of HUD
 * 3. The HUD document type description contains "HECM" (though we may not have
 *    the description in the data — the dual-mortgage pattern is the primary signal)
 *
 * A single HUD mortgage is just a regular FHA loan — NOT a reverse mortgage.
 */
export function detectReverseMortgage(mortgages: ACRISDocument[]): ReverseMortgageInfo {
  const none: ReverseMortgageInfo = { detected: false, borrower: null, date: null, amount: null, lender: null, docs: [] };

  // Group mortgages by date
  const byDate = new Map<string, ACRISDocument[]>();
  for (const m of mortgages) {
    const key = m.docDate || m.recorded || "";
    if (!key || key === "unknown") continue; // skip undated mortgages
    if (!byDate.has(key)) byDate.set(key, []);
    byDate.get(key)!.push(m);
  }

  // Look for the reverse mortgage pattern: same date, same amount, one HUD + one private
  for (const [date, group] of byDate) {
    if (group.length < 2) continue;

    const hudDocs = group.filter(m => isHudParty(m.party2));
    const privateDocs = group.filter(m => isPrivateLender(m.party2));

    if (hudDocs.length === 0 || privateDocs.length === 0) continue;

    // Check for matching amounts between HUD and private lender
    for (const hud of hudDocs) {
      const hudAmount = parseFloat(hud.amount) || 0;
      if (hudAmount === 0) continue;

      const matchingPrivate = privateDocs.find(p => {
        const pAmount = parseFloat(p.amount) || 0;
        return Math.abs(pAmount - hudAmount) < 1; // same amount (within rounding)
      });

      if (matchingPrivate) {
        return {
          detected: true,
          borrower: hud.party1,
          date,
          amount: hud.amount,
          lender: `${matchingPrivate.party2} / ${hud.party2}`,
          docs: [matchingPrivate, hud],
        };
      }
    }
  }

  return none;
}

const MAX_RETRIES = 3;
const RETRY_DELAYS = [10000, 20000, 40000]; // 10s, 20s, 40s backoff

function isBandwidthPage(url: string, html: string): boolean {
  return url.includes("BandwidthPolicy") || html.includes("BandwidthPolicy") || html.includes("ACRIS-BW-POL");
}

function retrySleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    });
  });
}

/** Search ACRIS NYC by Borough/Block/Lot and return all documents */
export async function searchACRIS(borough: string, block: string, lot: string, signal?: AbortSignal): Promise<ACRISDocument[]> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delay = RETRY_DELAYS[attempt - 1] || 40000;
      console.log(`[acris] Rate limited — waiting ${delay / 1000}s before retry ${attempt}/${MAX_RETRIES}...`);
      await retrySleep(delay, signal);
    }

    const result = await searchACRISOnce(borough, block, lot, signal);
    if (result !== null) return result;
  }

  throw new Error("ACRIS rate limited after all retries — try increasing SCRAPER_DELAY_MS");
}

async function searchACRISOnce(borough: string, block: string, lot: string, signal?: AbortSignal): Promise<ACRISDocument[] | null> {
  const jar = new CookieJar();

  // Step 1: Establish session
  const mainPage = await fetchWithJar(jar, "GET", `${BASE}/CP/CoverPage/MainMenu`, undefined, signal);
  if (isBandwidthPage(mainPage.url, mainPage.text)) {
    console.log(`[acris] Bandwidth page on session init`);
    return null;
  }

  // Step 2: Get CSRF token
  const bblPage = await fetchWithJar(jar, "GET", `${BASE}/DS/DocumentSearch/BBL`, undefined, signal);
  if (isBandwidthPage(bblPage.url, bblPage.text)) {
    console.log(`[acris] Bandwidth page on BBL form`);
    return null;
  }

  const $ = cheerio.load(bblPage.text);
  const csrfTokens: string[] = [];
  $('input[name="__RequestVerificationToken"]').each((_, el) => {
    const val = $(el).attr("value");
    if (val) csrfTokens.push(val);
  });
  const token = csrfTokens[csrfTokens.length - 1] || csrfTokens[0] || "";

  // Step 3: Search
  const formData = new URLSearchParams({
    __RequestVerificationToken: token,
    hid_borough: borough,
    hid_borough_name: "",
    hid_block: block,
    hid_block_value: block,
    hid_lot: lot,
    hid_lot_value: lot.padStart(4, "0"),
    hid_unit: "",
    hid_selectdate: "To Current Date",
    hid_datefromm: "", hid_datefromd: "", hid_datefromy: "",
    hid_datetom: "", hid_datetod: "", hid_datetoy: "",
    hid_doctype: "", hid_doctype_name: "",
    hid_max_rows: "200",
    hid_page: "1",
    hid_ReqID: "",
    hid_SearchType: "BBL",
    hid_ISIntranet: "N",
    hid_sort: "",
  }).toString();

  const result = await fetchWithJar(jar, "POST", `${BASE}/DS/DocumentSearch/BBLResult`, formData, signal);
  console.log(`[acris] BBLResult status=${result.status} html=${result.text.length} chars, url=${result.url}`);

  if (isBandwidthPage(result.url, result.text)) {
    console.log(`[acris] Bandwidth page on search results`);
    return null;
  }

  const $r = cheerio.load(result.text);

  const docs: ACRISDocument[] = [];
  const allTrStyles = $r("tr[style]");
  console.log(`[acris] Found ${allTrStyles.length} tr[style] rows in result page`);

  allTrStyles.each((i, row) => {
    const cells = $r(row).find("td");
    if (cells.length < 11) {
      console.log(`[acris] Row ${i}: only ${cells.length} cells, skipping`);
      return;
    }

    const detButton = $r(cells[0]).find('input[name="DET"]');
    const onclick = detButton.attr("onclick") || "";
    const docIdMatch = onclick.match(/go_detail\("([^"]+)"\)/);

    const doc: ACRISDocument = {
      crfn: $r(cells[2]).text().trim(),
      lot: $r(cells[3]).text().trim(),
      partial: $r(cells[4]).text().trim(),
      docDate: $r(cells[5]).text().trim(),
      recorded: $r(cells[6]).text().trim(),
      docType: $r(cells[7]).text().trim(),
      pages: $r(cells[8]).text().trim(),
      party1: $r(cells[9]).text().trim(),
      party2: $r(cells[10]).text().trim(),
      amount: cells.length > 14 ? $r(cells[14]).text().trim() : "",
      docId: docIdMatch?.[1] || "",
    };

    console.log(`[acris] Row ${i}: docType="${doc.docType}" party1="${doc.party1}" party2="${doc.party2}" date="${doc.docDate}"`);
    docs.push(doc);
  });

  return docs;
}

/** Minimum delay between ACRIS requests — defaults to 5s to avoid bandwidth page */
export const ACRIS_MIN_DELAY = parseInt(process.env.ACRIS_DELAY_MS ?? "5000", 10);

/** Check if billing name looks like a bank/servicer rather than a person */
function billingIsBank(billing: string): boolean {
  if (!billing) return false;
  const lower = billing.toLowerCase();
  const bankKeywords = [
    "bank", "mortgage", "loan", "lending", "servic", "financial",
    "credit", "capital", "fund", "trust", "corp", "llc", "inc",
    "aetna", "pennymac", "wells fargo", "chase", "citi", "nationstar",
    "ocwen", "ditech", "sps", "shellpoint", "phh", "loancare",
    "cenlar", "flagstar", "freedom", "caliber", "newrez", "mr. cooper",
  ];
  return bankKeywords.some(kw => lower.includes(kw));
}

/** Analyze ACRIS documents for reverse mortgage lead detection */
export function analyzeDocuments(docs: ACRISDocument[], ownerName: string | null, billingName?: string | null): DocumentAnalysis {
  const mortgages = docs.filter(d => d.docType === "MORTGAGE");
  const satisfactions = docs.filter(d => d.docType === "SATISFACTION OF MORTGAGE");
  const deeds = docs.filter(d => d.docType === "DEED");
  const assignments = docs.filter(d => d.docType === "ASSIGNMENT, MORTGAGE");

  const reverseMortgage = detectReverseMortgage(mortgages);

  const parseDate = (d: ACRISDocument) => {
    if (d.docDate) return new Date(d.docDate).getTime();
    if (d.recorded) return new Date(d.recorded).getTime();
    return 0;
  };

  const sortedDeeds = [...deeds].sort((a, b) => parseDate(b) - parseDate(a));
  const lastDeed = sortedDeeds[0] || null;

  const sortedMortgages = [...mortgages].sort((a, b) => parseDate(b) - parseDate(a));
  const latestMortgage = sortedMortgages[0] || null;

  let hasBeenSold = false;
  const reasons: string[] = [];

  const originalBorrower = findOriginalBorrower(mortgages);

  if (lastDeed) {
    const buyer = lastDeed.party2;
    const seller = lastDeed.party1;

    const isSelfTransfer = namesMatch(seller, buyer);

    if (!isSelfTransfer && lastDeed.docDate) {
      const buyerMatchesBorrower = originalBorrower ? namesMatch(buyer, originalBorrower) : false;
      const buyerIsCurrentOwner = ownerName ? namesMatch(buyer, ownerName) : false;

      if (!buyerMatchesBorrower && !buyerIsCurrentOwner) {
        hasBeenSold = true;
        reasons.push(`Property SOLD: ${seller} -> ${buyer} on ${lastDeed.docDate} ($${lastDeed.amount || "0"})`);
      }
    }

    if (latestMortgage && originalBorrower) {
      const sameAsBorrower = namesMatch(latestMortgage.party1, originalBorrower);
      const latestIsCurrentOwner = ownerName ? namesMatch(latestMortgage.party1, ownerName) : false;

      if (!sameAsBorrower && !latestIsCurrentOwner) {
        hasBeenSold = true;
        if (!reasons.some(r => r.includes("SOLD"))) {
          reasons.push(`Property SOLD: New mortgage by ${latestMortgage.party1} (not original borrower ${originalBorrower})`);
        }
        reasons.push(`New owner mortgage: ${latestMortgage.party1} -> ${latestMortgage.party2} $${latestMortgage.amount} on ${latestMortgage.docDate}`);
      }
    }
  }

  const activeMortgageCount = mortgages.length - satisfactions.length;

  let reverseMortgageSatisfied = false;
  if (reverseMortgage.detected && reverseMortgage.lender) {
    const chainEntities = new Set<string>();
    for (const rmDoc of reverseMortgage.docs) {
      chainEntities.add(normalizeName(rmDoc.party2));
    }

    let changed = true;
    while (changed) {
      changed = false;
      for (const a of assignments) {
        const assignorNorm = normalizeName(a.party1);
        const assigneeNorm = normalizeName(a.party2);
        const matchesChain = [...chainEntities].some(e =>
          e.includes(assignorNorm) || assignorNorm.includes(e)
        );
        if (matchesChain && !chainEntities.has(assigneeNorm)) {
          chainEntities.add(assigneeNorm);
          changed = true;
        }
      }
    }

    reverseMortgageSatisfied = satisfactions.some(s => {
      const satLenderNorm = normalizeName(s.party2);
      return [...chainEntities].some(e =>
        e.includes(satLenderNorm) || satLenderNorm.includes(e)
      );
    });
  }

  // Billing name pre-filter: if billing is a bank, it's NOT a reverse mortgage lead
  const billingIsBankName = billingName ? billingIsBank(billingName) : false;

  // Check if the reverse mortgage borrower matches the current owner
  let reverseMortgageBorrowerIsCurrent = true;
  if (reverseMortgage.detected && reverseMortgage.borrower && ownerName) {
    reverseMortgageBorrowerIsCurrent = namesMatch(reverseMortgage.borrower, ownerName);
  }

  if (reverseMortgage.detected) {
    reasons.push(`REVERSE MORTGAGE: ${reverseMortgage.borrower} -> ${reverseMortgage.lender} ($${reverseMortgage.amount}) on ${reverseMortgage.date}`);
    reasons.push(`Dual mortgage pattern: same amount, same date, private lender + HUD`);
    if (!reverseMortgageBorrowerIsCurrent) {
      reasons.push(`Reverse mortgage borrower "${reverseMortgage.borrower}" is NOT the current owner "${ownerName}"`);
    }
    if (reverseMortgageSatisfied) {
      reasons.push("Reverse mortgage has been SATISFIED");
    }
  } else {
    reasons.push("No reverse mortgage detected (no dual-mortgage pattern found)");
  }

  if (billingName) {
    if (billingIsBankName) {
      reasons.push(`Billing name "${billingName}" is a bank/servicer — NOT a reverse mortgage`);
    } else {
      reasons.push(`Billing name "${billingName}" is the owner — consistent with reverse mortgage`);
    }
  }

  let isGoodLead = reverseMortgage.detected && !hasBeenSold && !reverseMortgageSatisfied && !billingIsBankName && reverseMortgageBorrowerIsCurrent;

  if (hasBeenSold) {
    reasons.push("BAD LEAD: Property has been sold");
  }

  if (!reverseMortgageBorrowerIsCurrent && reverseMortgage.detected) {
    reasons.push("BAD LEAD: Reverse mortgage was under a previous owner");
  }

  if (billingIsBankName && reverseMortgage.detected) {
    reasons.push("BAD LEAD: Billing is a bank — reverse mortgage likely not active");
  }

  if (reverseMortgageSatisfied && !hasBeenSold) {
    reasons.push("BAD LEAD: Reverse mortgage has been satisfied (paid off)");
  }

  if (!reverseMortgage.detected) {
    isGoodLead = false;
    reasons.push("BAD LEAD: No reverse mortgage found on this property");
  }

  if (isGoodLead) {
    reasons.push("GOOD LEAD: Active reverse mortgage, current owner is borrower, billing is owner");
  }

  return {
    mortgages,
    satisfactions,
    deeds,
    assignments,
    reverseMortgage,
    activeMortgageCount,
    hasBeenSold,
    lastDeed,
    isGoodLead,
    reasons,
  };
}

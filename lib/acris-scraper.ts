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

/** Known reverse mortgage lenders / keywords in party2 */
const REVERSE_MORTGAGE_LENDERS = [
  "hud", "housing and urban", "housing & urban", "secretary of h",
  "hecm", "reverse mortgage",
  "mers", "mortgage electronic registration",
];

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z]/g, "");
}

function isReverseMortgageLender(party: string): boolean {
  const lower = party.toLowerCase();
  return REVERSE_MORTGAGE_LENDERS.some(kw => lower.includes(kw));
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
 * Detect reverse mortgage pattern:
 * Two MORTGAGE docs filed on the same date by the same borrower,
 * where one goes to HUD/Secretary of Housing and the other to MERS or the lender.
 */
export function detectReverseMortgage(mortgages: ACRISDocument[]): ReverseMortgageInfo {
  const none: ReverseMortgageInfo = { detected: false, borrower: null, date: null, amount: null, lender: null, docs: [] };

  // Group mortgages by date
  const byDate = new Map<string, ACRISDocument[]>();
  for (const m of mortgages) {
    const key = m.docDate || m.recorded || "unknown";
    if (!byDate.has(key)) byDate.set(key, []);
    byDate.get(key)!.push(m);
  }

  // Look for pairs on same date where at least one party2 is a known reverse mortgage lender
  for (const [date, group] of byDate) {
    if (group.length < 2) continue;

    const hudDoc = group.find(m => isReverseMortgageLender(m.party2));
    if (hudDoc) {
      return {
        detected: true,
        borrower: hudDoc.party1,
        date,
        amount: hudDoc.amount,
        lender: hudDoc.party2,
        docs: group,
      };
    }
  }

  // Fallback: single mortgage to HUD/reverse lender (some only file one doc)
  const singleHud = mortgages.find(m => isReverseMortgageLender(m.party2));
  if (singleHud) {
    return {
      detected: true,
      borrower: singleHud.party1,
      date: singleHud.docDate || singleHud.recorded || null,
      amount: singleHud.amount,
      lender: singleHud.party2,
      docs: [singleHud],
    };
  }

  return none;
}

/** Search ACRIS NYC by Borough/Block/Lot and return all documents */
export async function searchACRIS(borough: string, block: string, lot: string, signal?: AbortSignal): Promise<ACRISDocument[]> {
  const jar = new CookieJar();

  // Step 1: Establish session
  await fetchWithJar(jar, "GET", `${BASE}/CP/CoverPage/MainMenu`, undefined, signal);

  // Step 2: Get CSRF token
  const bblPage = await fetchWithJar(jar, "GET", `${BASE}/DS/DocumentSearch/BBL`, undefined, signal);
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
  const $r = cheerio.load(result.text);

  const docs: ACRISDocument[] = [];
  $r("tr[style]").each((_, row) => {
    const cells = $r(row).find("td");
    const detButton = $r(cells[0]).find('input[name="DET"]');
    const onclick = detButton.attr("onclick") || "";
    const docIdMatch = onclick.match(/go_detail\("([^"]+)"\)/);

    docs.push({
      crfn: $r(cells[2]).text().trim(),
      lot: $r(cells[3]).text().trim(),
      partial: $r(cells[4]).text().trim(),
      docDate: $r(cells[5]).text().trim(),
      recorded: $r(cells[6]).text().trim(),
      docType: $r(cells[7]).text().trim(),
      pages: $r(cells[8]).text().trim(),
      party1: $r(cells[9]).text().trim(),
      party2: $r(cells[10]).text().trim(),
      amount: $r(cells[14]).text().trim(),
      docId: docIdMatch?.[1] || "",
    });
  });

  return docs;
}

/** Analyze ACRIS documents for reverse mortgage lead detection */
export function analyzeDocuments(docs: ACRISDocument[], ownerName: string | null): DocumentAnalysis {
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

    const sellerNorm = normalizeName(seller);
    const buyerNorm = normalizeName(buyer);
    const isSelfTransfer = sellerNorm === buyerNorm ||
      sellerNorm.includes(buyerNorm) ||
      buyerNorm.includes(sellerNorm);

    if (!isSelfTransfer && lastDeed.docDate) {
      const borrowerNorm = originalBorrower ? normalizeName(originalBorrower) : "";
      const ownerNorm = ownerName ? normalizeName(ownerName) : "";
      const buyerMatchesBorrower = borrowerNorm &&
        (buyerNorm.includes(borrowerNorm) || borrowerNorm.includes(buyerNorm));
      // If the deed buyer is the current owner, this is how they acquired the property — not a resale
      const buyerIsCurrentOwner = ownerNorm &&
        (buyerNorm.includes(ownerNorm) || ownerNorm.includes(buyerNorm));

      if (!buyerMatchesBorrower && !buyerIsCurrentOwner) {
        hasBeenSold = true;
        reasons.push(`Property SOLD: ${seller} -> ${buyer} on ${lastDeed.docDate} ($${lastDeed.amount || "0"})`);
      }
    }

    if (latestMortgage && originalBorrower) {
      const latestBorrowerNorm = normalizeName(latestMortgage.party1);
      const origNorm = normalizeName(originalBorrower);
      const ownerNorm = ownerName ? normalizeName(ownerName) : "";
      const sameAsBorrower = latestBorrowerNorm.includes(origNorm) || origNorm.includes(latestBorrowerNorm);
      // If the latest mortgage is by the current owner, it's not evidence of a sale
      const latestIsCurrentOwner = ownerNorm &&
        (latestBorrowerNorm.includes(ownerNorm) || ownerNorm.includes(latestBorrowerNorm));

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

  if (reverseMortgage.detected) {
    reasons.push(`REVERSE MORTGAGE: ${reverseMortgage.borrower} -> ${reverseMortgage.lender} ($${reverseMortgage.amount}) on ${reverseMortgage.date}`);
    if (reverseMortgage.docs.length >= 2) {
      reasons.push(`Filed as ${reverseMortgage.docs.length} docs on same date (typical reverse mortgage pattern)`);
    }
    if (reverseMortgageSatisfied) {
      reasons.push("Reverse mortgage has been SATISFIED");
    }
  } else {
    reasons.push("No reverse mortgage detected");
  }

  let isGoodLead = reverseMortgage.detected && !hasBeenSold && !reverseMortgageSatisfied;

  if (hasBeenSold) {
    reasons.push("BAD LEAD: Property has been sold");
  }

  if (reverseMortgageSatisfied && !hasBeenSold) {
    reasons.push("BAD LEAD: Reverse mortgage has been satisfied (paid off)");
  }

  if (!reverseMortgage.detected) {
    isGoodLead = false;
    reasons.push("BAD LEAD: No reverse mortgage found on this property");
  }

  if (isGoodLead) {
    reasons.push("GOOD LEAD: Active reverse mortgage, property not sold");
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

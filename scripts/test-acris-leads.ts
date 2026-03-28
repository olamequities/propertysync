import * as cheerio from "cheerio";
import { NYCPropertyScraper, parsePropertyData } from "../lib/scraper";

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

async function fetchWithJar(jar: CookieJar, method: string, url: string, body?: string) {
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

interface ACRISDocument {
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

async function searchACRIS(borough: string, block: string, lot: string): Promise<ACRISDocument[]> {
  const jar = new CookieJar();

  // Step 1: Establish session
  await fetchWithJar(jar, "GET", `${BASE}/CP/CoverPage/MainMenu`);

  // Step 2: Get CSRF token
  const bblPage = await fetchWithJar(jar, "GET", `${BASE}/DS/DocumentSearch/BBL`);
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
    hid_max_rows: "99",
    hid_page: "1",
    hid_ReqID: "",
    hid_SearchType: "BBL",
    hid_ISIntranet: "N",
    hid_sort: "",
  }).toString();

  const result = await fetchWithJar(jar, "POST", `${BASE}/DS/DocumentSearch/BBLResult`, formData);
  const $r = cheerio.load(result.text);

  const docs: ACRISDocument[] = [];
  $r("tr[style]").each((_, row) => {
    const cells = $r(row).find("td");
    // Extract doc ID from onclick
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

interface ReverseMortgageInfo {
  detected: boolean;
  borrower: string | null;
  date: string | null;
  amount: string | null;
  lender: string | null;     // HUD / HECM lender
  docs: ACRISDocument[];     // the pair of mortgage docs
}

interface LeadAnalysis {
  address: string;
  borough: string;
  block: string | null;
  lot: string | null;
  ownerName: string | null;
  billingName: string | null;
  documents: ACRISDocument[];
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

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z]/g, "");
}

/** Find the original borrower — the party1 on the earliest mortgage */
function findOriginalBorrower(mortgages: ACRISDocument[]): string | null {
  if (mortgages.length === 0) return null;
  // Sort oldest first
  const sorted = [...mortgages].sort((a, b) => {
    const dateA = a.docDate ? new Date(a.docDate).getTime() : 0;
    const dateB = b.docDate ? new Date(b.docDate).getTime() : 0;
    return dateA - dateB;
  });
  return sorted[0].party1;
}

/** Known reverse mortgage lenders / keywords in party2 */
const REVERSE_MORTGAGE_LENDERS = [
  "hud", "housing and urban", "housing & urban", "secretary of h",
  "hecm", "reverse mortgage",
  "mers", "mortgage electronic registration",
];

function isReverseMortgageLender(party: string): boolean {
  const lower = party.toLowerCase();
  return REVERSE_MORTGAGE_LENDERS.some(kw => lower.includes(kw));
}

/**
 * Detect reverse mortgage pattern:
 * Two MORTGAGE docs filed on the same date by the same borrower,
 * where one goes to HUD/Secretary of Housing and the other to MERS or the lender.
 */
function detectReverseMortgage(mortgages: ACRISDocument[]): ReverseMortgageInfo {
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

function analyzeDocuments(docs: ACRISDocument[], ownerName: string | null): {
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
} {
  const mortgages = docs.filter(d => d.docType === "MORTGAGE");
  const satisfactions = docs.filter(d => d.docType === "SATISFACTION OF MORTGAGE");
  const deeds = docs.filter(d => d.docType === "DEED");
  const assignments = docs.filter(d => d.docType === "ASSIGNMENT, MORTGAGE");

  // Detect reverse mortgage
  const reverseMortgage = detectReverseMortgage(mortgages);

  // Sort deeds by date (most recent first) — use recorded date as fallback
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

  // --- SALE DETECTION ---
  // Strategy: The most recent deed tells us who currently owns the property.
  // If the buyer (party2) on the most recent deed is NOT the original mortgage borrower,
  // the property has changed hands.

  const originalBorrower = findOriginalBorrower(
    // Only look at mortgages from when the "target" owner had them — filter by reverse mortgage types (HUD, MERS, etc.)
    mortgages
  );

  if (lastDeed) {
    const buyer = lastDeed.party2;
    const seller = lastDeed.party1;

    // Check 1: Is the most recent deed a self-transfer? (e.g., WHITE -> WHITE = not a sale)
    const sellerNorm = normalizeName(seller);
    const buyerNorm = normalizeName(buyer);
    const isSelfTransfer = sellerNorm === buyerNorm ||
      sellerNorm.includes(buyerNorm) ||
      buyerNorm.includes(sellerNorm);

    if (!isSelfTransfer && lastDeed.docDate) {
      // Check 2: Does the buyer match the original borrower?
      const borrowerNorm = originalBorrower ? normalizeName(originalBorrower) : "";
      const buyerMatchesBorrower = borrowerNorm &&
        (buyerNorm.includes(borrowerNorm) || borrowerNorm.includes(buyerNorm));

      if (!buyerMatchesBorrower) {
        hasBeenSold = true;
        reasons.push(`Property SOLD: ${seller} -> ${buyer} on ${lastDeed.docDate} ($${lastDeed.amount || "0"})`);
      }
    }

    // Check 3: Is there a brand new mortgage by someone OTHER than the original borrower?
    // (new buyer took out their own mortgage — definitive sale signal)
    if (latestMortgage && originalBorrower) {
      const latestBorrowerNorm = normalizeName(latestMortgage.party1);
      const origNorm = normalizeName(originalBorrower);
      const sameAsBorrower = latestBorrowerNorm.includes(origNorm) || origNorm.includes(latestBorrowerNorm);

      if (!sameAsBorrower) {
        hasBeenSold = true;
        if (!reasons.some(r => r.includes("SOLD"))) {
          reasons.push(`Property SOLD: New mortgage by ${latestMortgage.party1} (not original borrower ${originalBorrower})`);
        }
        reasons.push(`New owner mortgage: ${latestMortgage.party1} -> ${latestMortgage.party2} $${latestMortgage.amount} on ${latestMortgage.docDate}`);
      }
    }
  }

  // Active mortgage calculation
  const activeMortgageCount = mortgages.length - satisfactions.length;

  // Check if the reverse mortgage itself has been satisfied.
  // We trace the assignment chain from the reverse mortgage lenders to see who currently holds it,
  // then check if any satisfaction goes to an entity in that chain.
  let reverseMortgageSatisfied = false;
  if (reverseMortgage.detected && reverseMortgage.lender) {
    // Build the set of entities that have held this reverse mortgage
    // Start with the original lenders on the reverse mortgage docs
    const chainEntities = new Set<string>();
    for (const rmDoc of reverseMortgage.docs) {
      chainEntities.add(normalizeName(rmDoc.party2));
    }

    // Follow the assignment chain: if party1 is in the chain, add party2
    // Repeat until no new entities are added (transitive closure)
    let changed = true;
    while (changed) {
      changed = false;
      for (const a of assignments) {
        const assignorNorm = normalizeName(a.party1);
        const assigneeNorm = normalizeName(a.party2);
        // Check if the assignor matches any entity in the chain
        const matchesChain = [...chainEntities].some(e =>
          e.includes(assignorNorm) || assignorNorm.includes(e)
        );
        if (matchesChain && !chainEntities.has(assigneeNorm)) {
          chainEntities.add(assigneeNorm);
          changed = true;
        }
      }
    }

    console.log(`  Reverse mortgage holder chain: ${[...chainEntities].join(", ")}`);

    // Now check if any satisfaction's party2 (the lender being paid) matches the chain
    reverseMortgageSatisfied = satisfactions.some(s => {
      const satLenderNorm = normalizeName(s.party2);
      return [...chainEntities].some(e =>
        e.includes(satLenderNorm) || satLenderNorm.includes(e)
      );
    });

    if (reverseMortgageSatisfied) {
      const matchingSat = satisfactions.find(s => {
        const satLenderNorm = normalizeName(s.party2);
        return [...chainEntities].some(e => e.includes(satLenderNorm) || satLenderNorm.includes(e));
      });
      console.log(`  Matched satisfaction: ${matchingSat?.party1} -> ${matchingSat?.party2} (${matchingSat?.docDate})`);
    }
  }

  // Reverse mortgage info
  if (reverseMortgage.detected) {
    reasons.push(`REVERSE MORTGAGE: ${reverseMortgage.borrower} -> ${reverseMortgage.lender} ($${reverseMortgage.amount}) on ${reverseMortgage.date}`);
    if (reverseMortgage.docs.length >= 2) {
      reasons.push(`  Filed as ${reverseMortgage.docs.length} docs on same date (typical reverse mortgage pattern)`);
    }
    if (reverseMortgageSatisfied) {
      reasons.push("  Reverse mortgage has been SATISFIED");
    }
  } else {
    reasons.push("No reverse mortgage detected");
  }

  // Determine if good lead:
  // Good = has reverse mortgage + not sold + reverse mortgage not satisfied
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

const BOROUGH_MAP: Record<string, string> = {
  manhattan: "1", bronx: "2", brooklyn: "3", queens: "4", "staten island": "5",
};

async function analyzeLead(houseNumber: string, street: string, borough: string): Promise<LeadAnalysis> {
  const boroughCode = BOROUGH_MAP[borough.toLowerCase()] || "4";

  console.log(`\n${"=".repeat(70)}`);
  console.log(`  ANALYZING: ${houseNumber} ${street}, ${borough}`);
  console.log(`${"=".repeat(70)}`);

  // Step 1: Get block/lot from property tax site
  console.log("\n  [1] Scraping property tax data...");
  const scraper = new NYCPropertyScraper();
  const propData = await scraper.getPropertyDataByAddress(houseNumber, street, boroughCode);
  console.log(`      Owner: ${propData.owner_name}`);
  console.log(`      Billing: ${propData.billing_name}`);
  console.log(`      Block: ${propData.block}, Lot: ${propData.lot}`);
  console.log(`      Borough: ${propData.borough}`);

  if (!propData.block || !propData.lot) {
    throw new Error("Could not find block/lot for address");
  }

  // Step 2: Search ACRIS
  console.log("\n  [2] Searching ACRIS documents...");
  const docs = await searchACRIS(boroughCode, propData.block, propData.lot);
  console.log(`      Found ${docs.length} documents`);

  // Print all documents
  console.log("\n  --- All Documents ---");
  docs.forEach((d, i) => {
    console.log(`  ${String(i + 1).padStart(3)}. ${d.docDate.padEnd(12)} | ${d.docType.padEnd(30)} | ${d.party1.substring(0, 30).padEnd(30)} -> ${d.party2.substring(0, 30).padEnd(30)} | $${d.amount}`);
  });

  // Step 3: Analyze
  console.log("\n  [3] Analyzing...");
  const analysis = analyzeDocuments(docs, propData.owner_name);

  console.log(`\n  --- Reverse Mortgage ---`);
  if (analysis.reverseMortgage.detected) {
    console.log(`  DETECTED: ${analysis.reverseMortgage.borrower} -> ${analysis.reverseMortgage.lender}`);
    console.log(`  Amount: $${analysis.reverseMortgage.amount} | Date: ${analysis.reverseMortgage.date}`);
    console.log(`  Filed as ${analysis.reverseMortgage.docs.length} doc(s)`);
  } else {
    console.log(`  Not detected`);
  }

  console.log(`\n  --- Summary ---`);
  console.log(`  Total Mortgages: ${analysis.mortgages.length} | Satisfactions: ${analysis.satisfactions.length} | Active: ${analysis.activeMortgageCount}`);
  console.log(`  Deeds: ${analysis.deeds.length} | Assignments: ${analysis.assignments.length}`);
  console.log(`  Property Sold: ${analysis.hasBeenSold}`);
  console.log(`  Last Deed: ${analysis.lastDeed ? `${analysis.lastDeed.docDate} | ${analysis.lastDeed.party1} -> ${analysis.lastDeed.party2}` : "N/A"}`);

  console.log(`\n  --- Verdict ---`);
  analysis.reasons.forEach(r => console.log(`  * ${r}`));

  return {
    address: `${houseNumber} ${street}`,
    borough,
    block: propData.block,
    lot: propData.lot,
    ownerName: propData.owner_name,
    billingName: propData.billing_name,
    documents: docs,
    ...analysis,
  };
}

async function main() {
  console.log("ACRIS Lead Analysis Tool");
  console.log("========================\n");

  // Example 1: Good reverse mortgage lead
  const lead1 = await analyzeLead("194-23", "115 AVENUE", "Queens");

  // Small delay between requests
  await new Promise(r => setTimeout(r, 2000));

  // Example 2: Reverse mortgage lead that has been sold
  const lead2 = await analyzeLead("193-11", "120 AVENUE", "Queens");

  // Final comparison
  console.log(`\n\n${"=".repeat(70)}`);
  console.log("  FINAL COMPARISON");
  console.log(`${"=".repeat(70)}`);
  for (const [label, lead] of [["GOOD EXAMPLE", lead1], ["SOLD EXAMPLE", lead2]] as const) {
    console.log(`\n  ${label}: ${lead.address} (${lead.borough})`);
    console.log(`    Block: ${lead.block}, Lot: ${lead.lot}`);
    console.log(`    Owner: ${lead.ownerName}`);
    console.log(`    Reverse Mortgage: ${lead.reverseMortgage.detected ? "YES" : "NO"}`);
    if (lead.reverseMortgage.detected) {
      console.log(`      Borrower: ${lead.reverseMortgage.borrower}`);
      console.log(`      Lender: ${lead.reverseMortgage.lender}`);
      console.log(`      Amount: $${lead.reverseMortgage.amount}`);
      console.log(`      Date: ${lead.reverseMortgage.date}`);
    }
    console.log(`    Active Mortgages: ${lead.activeMortgageCount}`);
    console.log(`    Sold: ${lead.hasBeenSold}`);
    console.log(`    VERDICT: ${lead.isGoodLead ? "GOOD LEAD ✓" : "BAD LEAD ✗"}`);
    lead.reasons.forEach(r => console.log(`    -> ${r}`));
  }
}

main().catch(console.error);

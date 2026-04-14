/**
 * Test the 6 example properties from the client to verify parcel analysis fixes.
 *
 * Expected results after fixes:
 * - 241-19 148 AVE (Queens)       — was SOLD, should be GOOD_LEAD
 * - 5506 AVE O (Brooklyn)         — was SOLD, should be GOOD_LEAD
 * - 1019 LAFAYETTE AVE (Brooklyn) — was SOLD, should be GOOD_LEAD
 * - 1059 HERKIMER ST (Brooklyn)   — was SOLD, should be GOOD_LEAD
 * - 2362 E 72 ST (Brooklyn)       — was SATISFIED, should be GOOD_LEAD
 * - 3029 ELY AVE (Bronx)          — was SATISFIED, should be GOOD_LEAD
 *
 * Usage: npx tsx scripts/test-parcel-fixes.ts
 */

import { searchACRIS } from "../lib/acris-opendata";
import { analyzeDocuments } from "../lib/acris-scraper";
import { NYCPropertyScraper } from "../lib/scraper";

interface TestCase {
  address: string;
  houseNumber: string;
  street: string;
  borough: string; // borough code: 1=Manhattan, 2=Bronx, 3=Brooklyn, 4=Queens
  block?: string;
  lot?: string;
  expectedGoodLead: boolean;
  previousBug: string; // what was wrong before
}

const cases: TestCase[] = [
  {
    address: "241-19 148 AVE, Queens",
    houseNumber: "241-19",
    street: "148 AVENUE",
    borough: "4",
    expectedGoodLead: true,
    previousBug: "SOLD (compared against earliest mortgage borrower instead of RM borrower)",
  },
  {
    address: "5506 AVE O, Brooklyn",
    houseNumber: "5506",
    street: "AVENUE O",
    borough: "3",
    expectedGoodLead: true,
    previousBug: "SOLD (compared against earliest mortgage borrower instead of RM borrower)",
  },
  {
    address: "1019 LAFAYETTE AVE, Brooklyn",
    houseNumber: "1019",
    street: "LAFAYETTE AVENUE",
    borough: "3",
    expectedGoodLead: true,
    previousBug: "SOLD (refinance treated as sale)",
  },
  {
    address: "1059 HERKIMER ST, Brooklyn",
    houseNumber: "1059",
    street: "HERKIMER STREET",
    borough: "3",
    expectedGoodLead: true,
    previousBug: "SOLD (surviving spouse transfer treated as sale)",
  },
  {
    address: "2362 E 72 ST, Brooklyn",
    houseNumber: "2362",
    street: "EAST 72 STREET",
    borough: "3",
    expectedGoodLead: true,
    previousBug: "SATISFIED (old mortgage satisfaction matched as RM satisfaction)",
  },
  {
    address: "3029 ELY AVE, Bronx",
    houseNumber: "3029",
    street: "ELY AVENUE",
    borough: "2",
    expectedGoodLead: true,
    previousBug: "SATISFIED (old mortgage satisfaction matched as RM satisfaction)",
  },
];

async function lookupBBL(c: TestCase): Promise<{ block: string; lot: string }> {
  if (c.block && c.lot) return { block: c.block, lot: c.lot };
  console.log(`  Looking up BBL for ${c.address}...`);
  const scraper = new NYCPropertyScraper();
  const data = await scraper.getPropertyDataByAddress(c.houseNumber, c.street, c.borough);
  if (!data.block || !data.lot) throw new Error(`Could not find BBL for ${c.address}`);
  console.log(`  Found block=${data.block} lot=${data.lot}`);
  return { block: data.block, lot: data.lot };
}

async function runTests() {
  let passed = 0;
  let failed = 0;

  for (const c of cases) {
    console.log(`\n${"=".repeat(80)}`);
    console.log(`Testing: ${c.address}`);
    console.log(`Previous bug: ${c.previousBug}`);
    console.log(`${"=".repeat(80)}`);

    try {
      const { block, lot } = await lookupBBL(c);

      const docs = await searchACRIS(c.borough, block, lot);
      console.log(`  Total docs: ${docs.length}`);

      const mortgages = docs.filter(d => d.docType === "MORTGAGE");
      const sats = docs.filter(d => d.docType === "SATISFACTION OF MORTGAGE");
      const deeds = docs.filter(d => d.docType === "DEED");
      const assigns = docs.filter(d => d.docType === "ASSIGNMENT, MORTGAGE");
      console.log(`  Mortgages: ${mortgages.length}, Satisfactions: ${sats.length}, Deeds: ${deeds.length}, Assignments: ${assigns.length}`);

      // Show deeds
      console.log("\n  DEEDS:");
      for (const d of deeds) {
        console.log(`    ${d.docDate} | ${d.party1} -> ${d.party2} | $${d.amount}`);
      }

      // Show mortgages
      console.log("\n  MORTGAGES:");
      for (const m of mortgages) {
        console.log(`    ${m.docDate} | ${m.party1} -> ${m.party2} | $${m.amount}`);
      }

      // Show satisfactions
      if (sats.length > 0) {
        console.log("\n  SATISFACTIONS:");
        for (const s of sats) {
          console.log(`    ${s.docDate} | ${s.party1} -> ${s.party2} | $${s.amount}`);
        }
      }

      const analysis = analyzeDocuments(docs, null, null);

      console.log(`\n  Reverse mortgage detected: ${analysis.reverseMortgage.detected}`);
      if (analysis.reverseMortgage.detected) {
        console.log(`  RM borrower: ${analysis.reverseMortgage.borrower}`);
        console.log(`  RM date: ${analysis.reverseMortgage.date}`);
        console.log(`  RM lender: ${analysis.reverseMortgage.lender}`);
      }
      console.log(`  Has been sold: ${analysis.hasBeenSold}`);
      console.log(`  Is good lead: ${analysis.isGoodLead}`);

      console.log("\n  Reasons:");
      for (const r of analysis.reasons) {
        console.log(`    - ${r}`);
      }

      const correct = analysis.isGoodLead === c.expectedGoodLead;
      if (correct) {
        console.log(`\n  ✓ PASS — isGoodLead=${analysis.isGoodLead} (expected ${c.expectedGoodLead})`);
        passed++;
      } else {
        console.log(`\n  ✗ FAIL — isGoodLead=${analysis.isGoodLead} (expected ${c.expectedGoodLead})`);
        failed++;
      }
    } catch (e: any) {
      console.log(`  ERROR: ${e.message}`);
      failed++;
    }
  }

  console.log(`\n${"=".repeat(80)}`);
  console.log(`RESULTS: ${passed} passed, ${failed} failed out of ${cases.length}`);
  console.log(`${"=".repeat(80)}`);

  process.exit(failed > 0 ? 1 : 0);
}

runTests();

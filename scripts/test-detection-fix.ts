import { searchACRIS } from "../lib/acris-opendata";
import { analyzeDocuments } from "../lib/acris-scraper";

interface TestCase {
  label: string;
  borough: string;
  block: string;
  lot: string;
  owner: string;
  billing: string;
  expected: "NOT_REVERSE" | "REVERSE";
}

const cases: TestCase[] = [
  // FALSE POSITIVE: FHA loan, not reverse. Billing=PENNYMAC (bank)
  { label: "10 SCHUYLER TERRACE (FHA, not reverse)", borough: "2", block: "5529", lot: "815", owner: "HOUSE, THOMAS", billing: "PENNYMAC", expected: "NOT_REVERSE" },
  // FALSE POSITIVE: HUD mortgage but not reverse. Billing=AETNA (bank)
  { label: "1000 TINTON AVENUE (HUD but not reverse)", borough: "2", block: "2669", lot: "22", owner: "POORAN, IAN M", billing: "AETNA", expected: "NOT_REVERSE" },
  // TRUE POSITIVE: actual reverse mortgage. Billing=IRETA LONDON (owner name)
  { label: "2166 BRUCKNER BLVD (real reverse mortgage)", borough: "2", block: "3688", lot: "41", owner: "IRETA LONDON", billing: "IRETA LONDON", expected: "REVERSE" },
];

async function test() {
  for (const c of cases) {
    console.log(`\n${"=".repeat(80)}`);
    console.log(`${c.label} — expected: ${c.expected}`);
    console.log(`${"=".repeat(80)}`);

    let docs;
    try {
      docs = await searchACRIS(c.borough, c.block, c.lot);
    } catch (e: any) {
      console.log("FETCH ERROR:", e.cause?.message || e.message);
      continue;
    }

    const mortgages = docs.filter(d => d.docType === "MORTGAGE");
    console.log(`\nTotal docs: ${docs.length}, Mortgages: ${mortgages.length}`);

    console.log("\nMORTGAGES:");
    for (const m of mortgages) {
      console.log(`  ${m.docDate} | $${m.amount} | ${m.party1} -> ${m.party2}`);
    }

    // Check for duplicate amount pairs on same date
    console.log("\nDUPLICATE AMOUNT PAIRS (same date):");
    const byDate = new Map<string, typeof mortgages>();
    for (const m of mortgages) {
      const key = m.docDate || "unknown";
      if (!byDate.has(key)) byDate.set(key, []);
      byDate.get(key)!.push(m);
    }
    for (const [date, group] of byDate) {
      if (group.length >= 2) {
        const amounts = group.map(g => g.amount);
        const hasDuplicateAmount = amounts.some((a, i) => amounts.indexOf(a) !== i);
        console.log(`  Date ${date}: ${group.length} mortgages, amounts=[${amounts.join(", ")}], duplicateAmount=${hasDuplicateAmount}`);
        for (const g of group) {
          console.log(`    ${g.party1} -> ${g.party2} $${g.amount}`);
        }
      }
    }

    const analysis = analyzeDocuments(docs, c.owner || null, c.billing || null);
    console.log(`\nRESULT: reverseMortgage=${analysis.reverseMortgage.detected}, isGoodLead=${analysis.isGoodLead}`);
    console.log(`EXPECTED: ${c.expected}`);
    const correct = (c.expected === "REVERSE") === analysis.reverseMortgage.detected;
    console.log(correct ? "✓ CORRECT" : "✗ WRONG");
  }
}

test().catch(e => console.error("Error:", e.message));

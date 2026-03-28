import { searchACRIS } from "../lib/acris-opendata";
import { analyzeDocuments } from "../lib/acris-scraper";

async function test() {
  // SCHUYLER TERRACE: borough=2 (Bronx), block=5529, lot=815, owner=HOUSE, THOMAS
  console.log("Testing full pipeline: Open Data API -> analyzeDocuments");
  console.log("Address: 10 SCHUYLER TERRACE, Bronx (B:2 Bl:5529 L:815)\n");

  const docs = await searchACRIS("2", "5529", "815");
  console.log(`Documents found: ${docs.length}`);
  console.log(`Mortgages: ${docs.filter(d => d.docType === "MORTGAGE").length}`);
  console.log(`Deeds: ${docs.filter(d => d.docType === "DEED").length}`);
  console.log(`Satisfactions: ${docs.filter(d => d.docType === "SATISFACTION OF MORTGAGE").length}`);
  console.log(`Assignments: ${docs.filter(d => d.docType === "ASSIGNMENT, MORTGAGE").length}`);

  const analysis = analyzeDocuments(docs, "HOUSE, THOMAS");

  console.log(`\nReverse mortgage detected: ${analysis.reverseMortgage.detected}`);
  console.log(`Has been sold: ${analysis.hasBeenSold}`);
  console.log(`Is good lead: ${analysis.isGoodLead}`);
  console.log(`\nReasons:`);
  analysis.reasons.forEach(r => console.log(`  - ${r}`));
}

test().catch(e => console.error("Error:", e.message));

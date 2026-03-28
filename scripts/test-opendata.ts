const SODA_BASE = "https://data.cityofnewyork.us/resource";
const LEGALS = "8h5j-fqxa";
const MASTER = "bnx9-e6tj";
const PARTIES = "636b-3b5g";
const DOC_CODES = "7isb-wh4c";

async function sodaQuery(dataset: string, params: string, limit = 200) {
  const url = `${SODA_BASE}/${dataset}.json?${params}&$limit=${limit}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`SODA ${resp.status}: ${await resp.text()}`);
  return resp.json();
}

async function test() {
  // Step 0: Discover column names
  console.log("=== COLUMN DISCOVERY ===");
  for (const [name, id] of [["legals", LEGALS], ["master", MASTER], ["parties", PARTIES], ["doc_codes", DOC_CODES]] as const) {
    const resp = await fetch(`${SODA_BASE}/${id}.json?$limit=1`);
    const data = await resp.json();
    console.log(`${name}: ${Object.keys(data[0]).join(", ")}`);
    console.log(`  sample: ${JSON.stringify(data[0])}`);
    console.log();
  }

  // Step 1: SCHUYLER TERRACE: borough=2 (Bronx), block=5529, lot=815
  const borough = 2, block = 5529, lot = 815;
  console.log(`\n=== SEARCH B:${borough} Bl:${block} L:${lot} ===`);

  const legals = await sodaQuery(LEGALS, `$where=${encodeURIComponent(`borough=${borough} AND block=${block} AND lot=${lot}`)}`);
  console.log(`Legals: ${legals.length}`);
  if (legals.length === 0) return;

  // Get document IDs - check what the column is actually called
  const sampleLegal = legals[0];
  const docIdKey = Object.keys(sampleLegal).find(k => k.toLowerCase().includes("document")) || "document_id";
  console.log(`Doc ID column: "${docIdKey}"`);

  const docIds = [...new Set(legals.map((l: any) => l[docIdKey]))] as string[];
  console.log(`Unique doc IDs: ${docIds.length}`);

  // Batch fetch masters (SODA has URL length limits, batch 20 at a time)
  const allMasters: any[] = [];
  const allParties: any[] = [];
  for (let i = 0; i < docIds.length; i += 20) {
    const batch = docIds.slice(i, i + 20);
    const idList = batch.map(id => `'${id}'`).join(",");
    const whereClause = encodeURIComponent(`${docIdKey} in(${idList})`);

    const masters = await sodaQuery(MASTER, `$where=${whereClause}`, 500);
    allMasters.push(...masters);

    const parties = await sodaQuery(PARTIES, `$where=${whereClause}`, 1000);
    allParties.push(...parties);
  }

  console.log(`Masters: ${allMasters.length}, Parties: ${allParties.length}`);

  // Check doc type column name
  const sampleMaster = allMasters[0];
  const docTypeKey = Object.keys(sampleMaster).find(k => k.toLowerCase().includes("doctype") || k.toLowerCase().includes("doc_type")) || "doc_type";
  const docDateKey = Object.keys(sampleMaster).find(k => k.toLowerCase().includes("docdate") || k.toLowerCase().includes("doc_date") || k.toLowerCase().includes("document_date")) || "doc_date";
  const docAmountKey = Object.keys(sampleMaster).find(k => k.toLowerCase().includes("amount")) || "doc_amount";
  console.log(`Master columns: docType="${docTypeKey}", docDate="${docDateKey}", amount="${docAmountKey}"`);

  // Count doc types
  const types: Record<string, number> = {};
  allMasters.forEach((m: any) => { types[m[docTypeKey]] = (types[m[docTypeKey]] || 0) + 1; });
  console.log("Doc types:", JSON.stringify(types, null, 2));

  // Check party columns
  const sampleParty = allParties[0];
  const partyTypeKey = Object.keys(sampleParty).find(k => k.toLowerCase().includes("partytype") || k.toLowerCase().includes("party_type")) || "partytype";
  const nameKey = Object.keys(sampleParty).find(k => k === "name") || "name";
  console.log(`Party columns: type="${partyTypeKey}", name="${nameKey}"`);

  // Print all docs with parties
  console.log("\n=== ALL DOCUMENTS ===");
  for (const m of allMasters) {
    const p1 = allParties.filter((p: any) => p[docIdKey] === m[docIdKey] && String(p[partyTypeKey]) === "1");
    const p2 = allParties.filter((p: any) => p[docIdKey] === m[docIdKey] && String(p[partyTypeKey]) === "2");
    console.log(`  ${m[docDateKey]} | ${m[docTypeKey]} | $${m[docAmountKey]} | ${p1.map((p: any) => p[nameKey]).join(",")} -> ${p2.map((p: any) => p[nameKey]).join(",")}`);
  }
}

test().catch(e => console.error("Error:", e.message));

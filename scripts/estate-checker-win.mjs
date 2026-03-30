/**
 * Estate Checker — run this on Windows directly (not WSL).
 *
 * Usage:
 *   cd D:\Robots\Clients\flow\olam\olam-app
 *   node scripts/estate-checker-win.mjs
 *
 * Prerequisites (run once):
 *   npm install rebrowser-puppeteer
 */

import puppeteer from "rebrowser-puppeteer";

const BOROUGH_TO_COURT = {
  "bronx": "3",
  "brooklyn": "24",
  "kings": "24",
  "manhattan": "31",
  "new york": "31",
  "queens": "41",
  "staten island": "43",
  "richmond": "43",
};

// Test cases
const SEARCHES = [
  { lastName: "LONDON", firstName: "IRETA", borough: "bronx" },
  { lastName: "HOUSE", firstName: "THOMAS", borough: "bronx" },
];

async function searchEstate(page, courtId, lastName, firstName) {
  // Navigate to search page
  await page.goto("https://websurrogates.nycourts.gov/Names/NameSearch", {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });

  // Wait for Cloudflare if needed
  if ((await page.title()).includes("moment")) {
    console.log("  Waiting for Cloudflare challenge...");
    try {
      await page.waitForFunction(() => !document.title.includes("moment"), { timeout: 30000 });
    } catch {
      throw new Error("Cloudflare challenge did not resolve");
    }
  }

  // Fill and submit form
  await page.select("#CourtSelect", courtId);
  await page.evaluate(() => {
    document.getElementById("LastNameBox").value = "";
    document.getElementById("FirstNameBox").value = "";
  });
  await page.type("#LastNameBox", lastName);
  await page.type("#FirstNameBox", firstName);
  await page.click("#NameSearchSubmitName");
  await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 15000 });

  const html = await page.content();
  if (html.includes("No Matching Files Were Found")) {
    return { found: false, fileNumbers: [] };
  }

  // Extract file numbers from results table
  const results = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll("table tr"));
    return rows.map(tr => {
      const cells = Array.from(tr.querySelectorAll("td"));
      return cells.map(td => td.innerText?.trim() || "");
    }).filter(r => r.length > 0);
  });

  return { found: true, results };
}

async function main() {
  console.log("Launching Chrome...");
  const browser = await puppeteer.launch({
    headless: false,
    args: ["--window-size=1280,720"],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });

  for (const s of SEARCHES) {
    const courtId = BOROUGH_TO_COURT[s.borough.toLowerCase()];
    if (!courtId) {
      console.log(`Unknown borough: ${s.borough}`);
      continue;
    }

    console.log(`\nSearching: ${s.lastName}, ${s.firstName} in ${s.borough} (court=${courtId})...`);
    try {
      const result = await searchEstate(page, courtId, s.lastName, s.firstName);
      if (!result.found) {
        console.log("  Result: No estate proceedings found.");
      } else {
        console.log("  Result: ESTATE FOUND!");
        result.results.forEach((row, i) => {
          console.log(`  Row ${i}: ${row.join(" | ")}`);
        });
      }
    } catch (e) {
      console.log(`  Error: ${e.message}`);
    }

    // Small delay between searches
    await new Promise(r => setTimeout(r, 2000));
  }

  await browser.close();
  console.log("\nDone.");
}

main().catch(e => console.error("Fatal:", e.message));

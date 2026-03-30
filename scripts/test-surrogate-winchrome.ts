import puppeteer from "rebrowser-puppeteer";

// This script connects to a Chrome instance already running on Windows with remote debugging.
// Start Chrome on Windows first:
//   "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="C:\temp\chrome-debug"

async function test() {
  console.log("Connecting to Windows Chrome on port 9222...");

  // Get the WebSocket URL from Chrome's debug endpoint
  const resp = await fetch("http://localhost:9222/json/version");
  const data = await resp.json() as any;
  console.log("Chrome version:", data.Browser);

  const browser = await puppeteer.connect({
    browserWSEndpoint: data.webSocketDebuggerUrl,
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });

  console.log("Navigating to surrogate court...");
  await page.goto("https://websurrogates.nycourts.gov/Names/NameSearch", {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });

  const title = await page.title();
  console.log("Title:", title);

  if (title.includes("moment")) {
    console.log("Cloudflare challenge. Waiting up to 30s...");
    try {
      await page.waitForFunction(() => !document.title.includes("moment"), { timeout: 30000 });
      console.log("Challenge PASSED! Title:", await page.title());
    } catch {
      console.log("Challenge did not resolve.");
      await page.close();
      browser.disconnect();
      return;
    }
  }

  const hasToken = await page.evaluate(() =>
    !!document.querySelector('input[name="__RequestVerificationToken"]')
  );
  console.log("Has CSRF token:", hasToken);

  if (!hasToken) {
    await page.close();
    browser.disconnect();
    return;
  }

  // Search LONDON, IRETA in Bronx
  console.log("\nSearching: LONDON, IRETA in Bronx...");
  await page.select("#CourtSelect", "3");
  await page.evaluate(() => {
    (document.getElementById("LastNameBox") as any).value = "";
    (document.getElementById("FirstNameBox") as any).value = "";
  });
  await page.type("#LastNameBox", "LONDON");
  await page.type("#FirstNameBox", "IRETA");
  await page.click("#NameSearchSubmitName");
  await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 15000 });

  const html = await page.content();
  const noMatch = html.includes("No Matching Files Were Found");
  console.log("No match:", noMatch);

  if (!noMatch) {
    console.log("FOUND RESULTS:");
    const rows = await page.evaluate(() => {
      return Array.from(document.querySelectorAll("table tr"))
        .slice(0, 15)
        .map(tr => (tr as HTMLElement).innerText?.replace(/\s+/g, " ").trim() || "");
    });
    rows.forEach((r, i) => { if (r) console.log(`  Row ${i}: ${r.substring(0, 250)}`); });
  }

  await page.close();
  browser.disconnect();
  console.log("\nDone.");
}

test().catch((e) => console.error("Error:", e.message));

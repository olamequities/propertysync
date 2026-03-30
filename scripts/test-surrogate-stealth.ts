import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

puppeteer.use(StealthPlugin());

async function test() {
  console.log("Launching stealth browser (headed via xvfb)...");
  const browser = await puppeteer.launch({
    headless: false,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled",
      "--window-size=1280,720",
    ],
    ignoreDefaultArgs: ["--enable-automation"],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });

  console.log("Navigating to surrogate court...");
  await page.goto("https://websurrogates.nycourts.gov/Names/NameSearch", {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });

  console.log("Initial title:", await page.title());

  // Wait for Cloudflare to resolve
  if ((await page.title()).includes("moment")) {
    console.log("Cloudflare challenge detected. Waiting up to 20s...");
    try {
      await page.waitForFunction(
        () => !document.title.includes("moment"),
        { timeout: 20000 }
      );
      console.log("Challenge passed! Title:", await page.title());
    } catch {
      console.log("Challenge did NOT resolve after 20s.");
      console.log("Title:", await page.title());
      await browser.close();
      return;
    }
  }

  // Check for form
  const hasToken = await page.evaluate(() =>
    !!document.querySelector('input[name="__RequestVerificationToken"]')
  );
  console.log("Has CSRF token:", hasToken);

  if (!hasToken) {
    console.log("No form. Exiting.");
    await browser.close();
    return;
  }

  // Search: LONDON, IRETA in Bronx
  console.log("\nSearching: LONDON, IRETA in Bronx...");
  await page.select("#CourtSelect", "3");
  await page.evaluate(() => {
    (document.getElementById("LastNameBox") as HTMLInputElement).value = "";
    (document.getElementById("FirstNameBox") as HTMLInputElement).value = "";
  });
  await page.type("#LastNameBox", "LONDON");
  await page.type("#FirstNameBox", "IRETA");
  await page.click("#NameSearchSubmitName");
  await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 15000 });

  const html = await page.content();
  const noMatch = html.includes("No Matching Files Were Found");
  console.log("No match:", noMatch);

  if (!noMatch) {
    console.log("Found results!");
    const rows = await page.evaluate(() => {
      const trs = document.querySelectorAll("table tr");
      return Array.from(trs).slice(0, 15).map(tr => tr.textContent?.replace(/\s+/g, " ").trim() || "");
    });
    rows.forEach((r, i) => { if (r) console.log(`  Row ${i}: ${r.substring(0, 200)}`); });
  }

  await browser.close();
  console.log("\nDone.");
}

test().catch((e) => console.error("Error:", e.message));

import { chromium } from "playwright";

async function test() {
  console.log("Launching browser...");
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 720 },
  });
  const page = await context.newPage();

  console.log("Navigating to surrogate court...");
  await page.goto("https://websurrogates.nycourts.gov/Names/NameSearch", {
    waitUntil: "domcontentloaded",
    timeout: 20000,
  });

  console.log("Page loaded. Title:", await page.title());
  console.log("URL:", page.url());

  // If Cloudflare challenge, wait for it to resolve
  const isChallenge = (await page.title()).includes("moment") || (await page.content()).includes("Just a moment");
  if (isChallenge) {
    console.log("Cloudflare challenge detected. Waiting up to 20s for it to resolve...");
    try {
      await page.waitForURL("**/Names/NameSearch", { timeout: 20000 });
      console.log("Challenge passed! New title:", await page.title());
    } catch {
      console.log("Challenge did not resolve. Taking screenshot...");
      const content = await page.content();
      console.log("Page content (first 500):", content.substring(0, 500));
      console.log("\nChecking for Turnstile/interactive challenge...");
      console.log("Has iframe:", content.includes("cf-turnstile") || content.includes("challenge-form"));
      await browser.close();
      return;
    }
  }

  // Verify we have the form
  const hasToken = await page.locator('input[name="__RequestVerificationToken"]').count();
  console.log("Has CSRF token:", hasToken > 0);

  if (hasToken === 0) {
    console.log("No form found. Content:");
    console.log((await page.content()).substring(0, 1000));
    await browser.close();
    return;
  }

  // Search: LONDON, IRETA in Bronx
  console.log("\nSearching: LONDON, IRETA in Bronx...");
  await page.selectOption("#CourtSelect", "3");
  await page.fill("#LastNameBox", "LONDON");
  await page.fill("#FirstNameBox", "IRETA");
  await page.click("#NameSearchSubmitName");
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(2000);

  const resultHtml = await page.content();
  const noMatch = resultHtml.includes("No Matching Files Were Found");
  console.log("No match:", noMatch);

  if (!noMatch) {
    console.log("Found results!");
    const rows = await page.locator("table tr").allTextContents();
    rows.slice(0, 15).forEach((r, i) => {
      const text = r.replace(/\s+/g, " ").trim();
      if (text) console.log(`  Row ${i}: ${text.substring(0, 200)}`);
    });
  } else {
    console.log("No estate proceedings found.");
  }

  await browser.close();
  console.log("\nDone.");
}

test().catch((e) => console.error("Error:", e.message));

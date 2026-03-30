import rebrowser from "rebrowser-puppeteer";

async function test() {
  console.log("Launching Windows Chrome via rebrowser-puppeteer...");
  const browser = await rebrowser.launch({
    headless: false,
    executablePath: "/mnt/c/Program Files/Google/Chrome/Application/chrome.exe",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--window-size=1280,720"],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });

  console.log("Navigating to surrogate court...");
  try {
    await page.goto("https://websurrogates.nycourts.gov/Names/NameSearch", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
  } catch (e: any) {
    console.log("Navigation error:", e.message.substring(0, 100));
  }

  const title = await page.title();
  console.log("Title:", title);

  if (title.includes("moment")) {
    console.log("Cloudflare challenge. Waiting up to 25s...");
    try {
      await page.waitForFunction(() => !document.title.includes("moment"), { timeout: 25000 });
      console.log("Challenge PASSED! Title:", await page.title());
    } catch {
      console.log("Challenge did not resolve.");
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
    await browser.close();
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

  // Search HOUSE, THOMAS
  console.log("\n--- HOUSE, THOMAS in Bronx ---");
  await page.goto("https://websurrogates.nycourts.gov/Names/NameSearch", {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  if ((await page.title()).includes("moment")) {
    await page.waitForFunction(() => !document.title.includes("moment"), { timeout: 15000 }).catch(() => null);
  }
  await page.select("#CourtSelect", "3");
  await page.evaluate(() => {
    (document.getElementById("LastNameBox") as any).value = "";
    (document.getElementById("FirstNameBox") as any).value = "";
  });
  await page.type("#LastNameBox", "HOUSE");
  await page.type("#FirstNameBox", "THOMAS");
  await page.click("#NameSearchSubmitName");
  await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 15000 });

  const html2 = await page.content();
  console.log("No match:", html2.includes("No Matching Files Were Found"));
  if (!html2.includes("No Matching Files Were Found")) {
    const rows2 = await page.evaluate(() => {
      return Array.from(document.querySelectorAll("table tr"))
        .slice(0, 15)
        .map(tr => (tr as HTMLElement).innerText?.replace(/\s+/g, " ").trim() || "");
    });
    rows2.forEach((r, i) => { if (r) console.log(`  Row ${i}: ${r.substring(0, 250)}`); });
  }

  await browser.close();
  console.log("\nDone.");
}

test().catch((e) => console.error("Error:", e.message));

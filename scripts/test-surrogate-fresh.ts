import * as cheerio from "cheerio";

const BASE = "https://websurrogates.nycourts.gov";
const CF_CLEARANCE = "8QvT1I_rysHJj6iIYxi4FL4ZeD0O6irrA.ZO0JCrHQg-1774827234-1.2.1.1-4wbhGBxGLccaxP4W9At1ZCEYjKNM4PaO3foN8f5MxA02LWNb3XcMah_P9BOXnouSm.NTmpaEaRKS21CyCl1Z4t1QZrzXVFd0p4UT.6PrKwv3dTCDOKn5yhWqcq8L0tXyYnBh_yoF6e2edM8cy04Bd3keKU8B4ch6kwhNY3gWwD7jyReaB4vqObeCebm9DvDgiTn5AGhRPy89PBUCe2I5STREW.lHcso_lb1DcpRw7aGDrCy5hMO6lFwdOYhqF5oV";

const cookies = new Map<string, string>();
cookies.set("cf_clearance", CF_CLEARANCE);

function cookieStr() {
  return Array.from(cookies.entries()).map(([k, v]) => `${k}=${v}`).join("; ");
}

function absorbCookies(resp: Response) {
  const sc = resp.headers.getSetCookie?.() ?? [];
  for (const c of sc) {
    const eq = c.indexOf("=");
    const semi = c.indexOf(";");
    if (eq > 0) cookies.set(c.slice(0, eq).trim(), c.slice(eq + 1, semi > 0 ? semi : undefined).trim());
  }
}

const HEADERS: Record<string, string> = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Upgrade-Insecure-Requests": "1",
  "sec-ch-ua": '"Chromium";v="146", "Not-A.Brand";v="24", "Google Chrome";v="146"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Windows"',
  "sec-fetch-dest": "document",
  "sec-fetch-mode": "navigate",
  "sec-fetch-site": "same-origin",
  "sec-fetch-user": "?1",
};

async function test() {
  // Step 1: GET search page
  console.log("GET /Names/NameSearch with fresh cf_clearance...");
  const page = await fetch(`${BASE}/Names/NameSearch`, {
    headers: { ...HEADERS, Cookie: cookieStr() },
    redirect: "follow",
  });
  absorbCookies(page);
  const html = await page.text();
  console.log(`Status: ${page.status}, HTML: ${html.length} chars`);
  console.log(`Just a moment: ${html.includes("Just a moment")}`);
  console.log(`Has form: ${html.includes("__RequestVerificationToken")}`);

  if (html.includes("Just a moment") || !html.includes("__RequestVerificationToken")) {
    console.log("Cookie didn't work.");
    console.log("First 300 chars:", html.substring(0, 300));
    return;
  }

  const $ = cheerio.load(html);
  const token = $('input[name="__RequestVerificationToken"]').val() as string;
  console.log(`CSRF token: ${token ? "found" : "NOT FOUND"}`);

  // Step 2: Search LONDON, IRETA in Bronx
  console.log("\nSearching: LONDON, IRETA in Bronx...");
  const form = new URLSearchParams({
    __RequestVerificationToken: token,
    CourtIDasString: "3",
    LastName: "LONDON",
    FirstName: "IRETA",
    SearchType: "Search",
  });

  const resp = await fetch(`${BASE}/Names/NameSearch`, {
    method: "POST",
    headers: { ...HEADERS, "Content-Type": "application/x-www-form-urlencoded", Cookie: cookieStr(), Referer: `${BASE}/Names/NameSearch`, Origin: BASE },
    body: form.toString(),
    redirect: "follow",
  });
  absorbCookies(resp);
  const r1 = await resp.text();
  console.log(`Status: ${resp.status}, HTML: ${r1.length}`);
  console.log(`No match: ${r1.includes("No Matching Files Were Found")}`);

  if (!r1.includes("No Matching Files Were Found")) {
    console.log("FOUND RESULTS:");
    const $r = cheerio.load(r1);
    $r("table tr").each((i, row) => {
      const text = $r(row).text().replace(/\s+/g, " ").trim();
      if (text && i < 20) console.log(`  Row ${i}: ${text.substring(0, 250)}`);
    });
  }

  // Step 3: Search HOUSE, THOMAS in Bronx
  console.log("\n--- HOUSE, THOMAS in Bronx ---");
  const page2 = await fetch(`${BASE}/Names/NameSearch`, {
    headers: { ...HEADERS, Cookie: cookieStr() },
    redirect: "follow",
  });
  absorbCookies(page2);
  const html2 = await page2.text();
  const $2 = cheerio.load(html2);
  const token2 = $2('input[name="__RequestVerificationToken"]').val() as string;

  const form2 = new URLSearchParams({
    __RequestVerificationToken: token2,
    CourtIDasString: "3",
    LastName: "HOUSE",
    FirstName: "THOMAS",
    SearchType: "Search",
  });

  const resp2 = await fetch(`${BASE}/Names/NameSearch`, {
    method: "POST",
    headers: { ...HEADERS, "Content-Type": "application/x-www-form-urlencoded", Cookie: cookieStr(), Referer: `${BASE}/Names/NameSearch`, Origin: BASE },
    body: form2.toString(),
    redirect: "follow",
  });
  absorbCookies(resp2);
  const r2 = await resp2.text();
  console.log(`Status: ${resp2.status}`);
  console.log(`No match: ${r2.includes("No Matching Files Were Found")}`);

  if (!r2.includes("No Matching Files Were Found")) {
    console.log("FOUND RESULTS:");
    const $r2 = cheerio.load(r2);
    $r2("table tr").each((i, row) => {
      const text = $r2(row).text().replace(/\s+/g, " ").trim();
      if (text && i < 20) console.log(`  Row ${i}: ${text.substring(0, 250)}`);
    });
  }
}

test().catch((e) => console.error("Error:", e.message));

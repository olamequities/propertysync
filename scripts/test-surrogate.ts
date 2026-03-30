import * as cheerio from "cheerio";

const BASE = "https://websurrogates.nycourts.gov";
const HEADERS: Record<string, string> = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Upgrade-Insecure-Requests": "1",
};

const cookies = new Map<string, string>();

function absorbCookies(resp: Response) {
  const sc = resp.headers.getSetCookie?.() ?? [];
  for (const c of sc) {
    const eq = c.indexOf("=");
    const semi = c.indexOf(";");
    if (eq > 0) {
      cookies.set(c.slice(0, eq).trim(), c.slice(eq + 1, semi > 0 ? semi : undefined).trim());
    }
  }
}

function cookieStr() {
  return Array.from(cookies.entries()).map(([k, v]) => `${k}=${v}`).join("; ");
}

async function test() {
  // Step 1: GET the search page
  console.log("GET /Names/NameSearch...");
  const page = await fetch(`${BASE}/Names/NameSearch`, {
    headers: { ...HEADERS, Cookie: cookieStr() },
    redirect: "follow",
  });
  absorbCookies(page);
  const html = await page.text();
  console.log(`Status: ${page.status}, HTML: ${html.length} chars`);
  console.log(`Cloudflare challenge: ${html.includes("cf-challenge") || html.includes("Checking your browser")}`);
  console.log(`Has search form: ${html.includes("NameSearch")}`);

  // Extract CSRF token
  const $ = cheerio.load(html);
  const token = $('input[name="__RequestVerificationToken"]').val() as string;
  console.log(`CSRF token: ${token ? token.substring(0, 40) + "..." : "NOT FOUND"}`);

  if (!token) {
    console.log("Cannot proceed without token. HTML snippet:");
    console.log(html.substring(0, 500));
    return;
  }

  // Step 2: POST search - Bronx (3), last=LONDON, first=IRETA (known reverse mortgage owner)
  console.log("\nPOST search: LONDON, IRETA in Bronx...");
  const form = new URLSearchParams({
    __RequestVerificationToken: token,
    CourtIDasString: "3",
    LastName: "LONDON",
    FirstName: "IRETA",
    SearchType: "Search",
  });

  const resp = await fetch(`${BASE}/Names/NameSearch`, {
    method: "POST",
    headers: {
      ...HEADERS,
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: cookieStr(),
      Referer: `${BASE}/Names/NameSearch`,
      Origin: BASE,
    },
    body: form.toString(),
    redirect: "follow",
  });
  absorbCookies(resp);
  const resultHtml = await resp.text();
  console.log(`Status: ${resp.status}, HTML: ${resultHtml.length} chars`);

  const noMatch = resultHtml.includes("No Matching Files Were Found");
  console.log(`No match: ${noMatch}`);

  if (!noMatch) {
    const $r = cheerio.load(resultHtml);
    console.log("\nFound results! Scanning for file data...");

    // Look for table rows with data
    $r("table tr").each((i, row) => {
      const text = $r(row).text().replace(/\s+/g, " ").trim();
      if (text && i < 20) console.log(`  Row ${i}: ${text.substring(0, 200)}`);
    });

    // Look for links to file details
    $r("a").each((_, el) => {
      const href = $r(el).attr("href") || "";
      if (href.includes("File") || href.includes("file")) {
        console.log(`  Link: ${href} -> ${$r(el).text().trim()}`);
      }
    });
  } else {
    console.log("No estate proceedings found for LONDON, IRETA in Bronx.");
  }

  // Step 3: Try another search - HOUSE, THOMAS
  console.log("\n--- Second search: HOUSE, THOMAS in Bronx ---");
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
    headers: {
      ...HEADERS,
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: cookieStr(),
      Referer: `${BASE}/Names/NameSearch`,
      Origin: BASE,
    },
    body: form2.toString(),
    redirect: "follow",
  });
  absorbCookies(resp2);
  const result2 = await resp2.text();
  console.log(`Status: ${resp2.status}, HTML: ${result2.length} chars`);
  console.log(`No match: ${result2.includes("No Matching Files Were Found")}`);

  if (!result2.includes("No Matching Files Were Found")) {
    const $r2 = cheerio.load(result2);
    $r2("table tr").each((i, row) => {
      const text = $r2(row).text().replace(/\s+/g, " ").trim();
      if (text && i < 20) console.log(`  Row ${i}: ${text.substring(0, 200)}`);
    });
  }
}

test().catch((e) => console.error("Error:", e.message));

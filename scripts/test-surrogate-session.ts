import * as cheerio from "cheerio";

const BASE = "https://websurrogates.nycourts.gov";

const SESSION_COOKIES = [
  "cf_clearance=0Jo2LVAbZ1coejlctRdnRg6i7AAazLPUzteifsX45aM-1774834016-1.2.1.1-gImHZkArmw9njTriB13miivrSsBJZTyhpYfZSrzonEj5LpGQz48EVkOhqXSqxCIfXNASN_KMsj.VIlZq1tRMWJ_foZah1NaxNBKV8u2vuG1O1e8CrelLdzCsOGfCz3cFj.Vso9kDAfElS4OeFAi2nOuuv9loAAQBwPNFpA9idnd1OmFE8X59uoYSB3f6A5oLXg5JugWEYXUkbQoJbqqmOnmHUESleqafEz8IWVbAzzk6esb_v86F9smIC.wnD48J",
  ".AspNetCore.Session=CfDJ8IGs8m2bB6BGihlbUyz8p0WP0DHY1wlgj8ZdyDb9%2FHHnqfQSK17mecG7sh1pJcnySoG6RxRRQlkxX1vvPD8ojfunysjXt2hBT6Hn%2FfVCtnJlXkDozJd4sF%2FfgAAhN8jq0K9npTxKSO1OTUki57CL3ujxjqshdBWMlPbWa7hphcRD",
  ".AspNetCore.WebSurrogateAuthenticationScheme=CfDJ8IGs8m2bB6BGihlbUyz8p0Wl7MsLUr-D9MD4SJ7aQEk0MQfS1a_erZA9hhZ5WpJGoAWknozpw4PVU-DLdEmrUPheUGXPAzlAdPogSBWAbJCzK_ZD6YUmU1TI32afylj6dwPEiFX-HaeX-UOmUr_aXGoakC0qIh_sjSIwiwJoeimGhhEcCGrg4Bs85BfIHrC6yJdg5va9TY5Owwg2_m4KNzquk8x4UX0WuEbbIF1psCgBTx3PGg_QvW8j1oDhKaJ7eQrP1nBfkfGjqPseLL7mKk5uDYpQIxywkEGZRtW-S1kwuFbiE0pOgAmVej5P9xSUCDl3MHt_LmLW1MjASA93XqL9JZ36fJsVSP9Up4ncFXjgsZEPd4Mmbfcc9SLCc8sEOg",
].join("; ");

const HEADERS: Record<string, string> = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  Cookie: SESSION_COOKIES,
};

async function search(lastName: string, firstName: string, courtId: string) {
  // GET the search page to get CSRF token
  const page = await fetch(`${BASE}/Names/NameSearch`, {
    headers: HEADERS,
    redirect: "follow",
  });
  const html = await page.text();

  if (html.includes("Just a moment") || html.includes("AuthenticatePage")) {
    console.log("  Session invalid or Cloudflare blocked");
    return null;
  }

  const $ = cheerio.load(html);
  const token = $('input[name="__RequestVerificationToken"]').val() as string;
  if (!token) {
    console.log("  No CSRF token found. Page title:", $("title").text());
    return null;
  }

  // Absorb any new cookies
  const newCookies = page.headers.getSetCookie?.() ?? [];
  let cookieStr = SESSION_COOKIES;
  for (const sc of newCookies) {
    const eq = sc.indexOf("=");
    const semi = sc.indexOf(";");
    if (eq > 0) {
      const name = sc.slice(0, eq).trim();
      const val = sc.slice(eq + 1, semi > 0 ? semi : undefined).trim();
      cookieStr += `; ${name}=${val}`;
    }
  }

  // POST the search
  const form = new URLSearchParams({
    __RequestVerificationToken: token,
    CourtIDasString: courtId,
    LastName: lastName,
    FirstName: firstName,
    SearchType: "Search",
  });

  const resp = await fetch(`${BASE}/Names/NameSearch`, {
    method: "POST",
    headers: {
      ...HEADERS,
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: cookieStr,
      Referer: `${BASE}/Names/NameSearch`,
      Origin: BASE,
    },
    body: form.toString(),
    redirect: "follow",
  });

  const resultHtml = await resp.text();

  if (resultHtml.includes("No Matching Files Were Found")) {
    return { found: false, fileNumbers: [] };
  }

  // Parse results
  const $r = cheerio.load(resultHtml);
  const rows: string[] = [];
  $r("table tr").each((i, row) => {
    const text = $r(row).text().replace(/\s+/g, " ").trim();
    if (text) rows.push(text);
  });

  return { found: true, rows };
}

async function test() {
  // Bronx = 3, Kings/Brooklyn = 24, Manhattan = 31, Queens = 41, Staten Island = 43
  const tests = [
    { last: "LONDON", first: "IRETA", court: "3", label: "Bronx" },
    { last: "HOUSE", first: "THOMAS", court: "3", label: "Bronx" },
  ];

  for (const t of tests) {
    console.log(`\nSearching: ${t.last}, ${t.first} in ${t.label}...`);
    const result = await search(t.last, t.first, t.court);

    if (!result) {
      console.log("  FAILED — session issue");
    } else if (!result.found) {
      console.log("  No estate proceedings found.");
    } else {
      console.log("  ESTATE FOUND!");
      result.rows.slice(0, 10).forEach((r, i) => console.log(`    Row ${i}: ${r.substring(0, 250)}`));
    }
  }
}

test().catch((e) => console.error("Error:", e.message));

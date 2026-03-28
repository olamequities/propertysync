import * as cheerio from "cheerio";

const BASE = "https://a836-acris.nyc.gov";

const HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Upgrade-Insecure-Requests": "1",
};

/** Simple cookie jar */
class CookieJar {
  private cookies = new Map<string, string>();

  absorb(response: Response) {
    const setCookies = response.headers.getSetCookie?.() ?? [];
    for (const sc of setCookies) {
      const parts = sc.split(";")[0];
      const eqIdx = parts.indexOf("=");
      if (eqIdx > 0) {
        this.cookies.set(parts.slice(0, eqIdx).trim(), parts.slice(eqIdx + 1).trim());
      }
    }
  }

  toString(): string {
    return Array.from(this.cookies.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
  }

  dump() {
    console.log("Cookies:", Object.fromEntries(this.cookies));
  }
}

const jar = new CookieJar();

async function fetchGet(url: string): Promise<{ text: string; status: number; url: string }> {
  let currentUrl = url;
  for (let i = 0; i < 10; i++) {
    console.log(`  GET ${currentUrl}`);
    const resp = await fetch(currentUrl, {
      headers: { ...HEADERS, Cookie: jar.toString() },
      redirect: "manual",
    });
    jar.absorb(resp);
    console.log(`  -> ${resp.status} ${resp.statusText}`);

    if (resp.status >= 300 && resp.status < 400) {
      const location = resp.headers.get("location");
      if (location) {
        currentUrl = location.startsWith("http") ? location : new URL(location, currentUrl).href;
        continue;
      }
    }

    return { text: await resp.text(), status: resp.status, url: currentUrl };
  }
  throw new Error("Too many redirects");
}

async function fetchPost(
  url: string,
  data: Record<string, string>
): Promise<{ text: string; status: number; url: string }> {
  const body = new URLSearchParams(data).toString();
  let currentUrl = url;
  let currentBody: string | undefined = body;
  let currentMethod = "POST";

  for (let i = 0; i < 10; i++) {
    console.log(`  ${currentMethod} ${currentUrl}`);
    const resp = await fetch(currentUrl, {
      method: currentMethod,
      headers: {
        ...HEADERS,
        Cookie: jar.toString(),
        ...(currentMethod === "POST"
          ? { "Content-Type": "application/x-www-form-urlencoded" }
          : {}),
      },
      body: currentMethod === "POST" ? currentBody : undefined,
      redirect: "manual",
    });
    jar.absorb(resp);
    console.log(`  -> ${resp.status} ${resp.statusText}`);

    if (resp.status >= 300 && resp.status < 400) {
      const location = resp.headers.get("location");
      if (location) {
        currentUrl = location.startsWith("http") ? location : new URL(location, currentUrl).href;
        currentMethod = "GET";
        currentBody = undefined;
        continue;
      }
    }

    return { text: await resp.text(), status: resp.status, url: currentUrl };
  }
  throw new Error("Too many redirects");
}

async function main() {
  const borough = "4";  // Queens
  const block = "11012";
  const lot = "54";

  // Step 1: Hit the main page / cover page to establish session
  console.log("\n=== Step 1: Visit cover page ===");
  const cover = await fetchGet(`${BASE}/CP/CoverPage/MainMenu`);
  console.log(`  Page length: ${cover.text.length}`);

  // Step 2: Visit the BBL search page to get CSRF token
  console.log("\n=== Step 2: Visit BBL search page ===");
  const bblPage = await fetchGet(`${BASE}/DS/DocumentSearch/BBL`);
  console.log(`  Page length: ${bblPage.text.length}`);

  const $ = cheerio.load(bblPage.text);

  // Extract CSRF tokens
  const csrfTokens: string[] = [];
  $('input[name="__RequestVerificationToken"]').each((_, el) => {
    const val = $(el).attr("value");
    if (val) csrfTokens.push(val);
  });
  console.log(`  Found ${csrfTokens.length} CSRF tokens`);

  // Check if we got the actual form or got blocked
  const hasForm = $('form[name="DATA"]').length > 0;
  const hasGlobal = $('form[name="global"]').length > 0;
  console.log(`  Has DATA form: ${hasForm}, Has global form: ${hasGlobal}`);

  if (!hasForm) {
    console.log("\n  Page title:", $("title").text());
    console.log("  Body preview:", bblPage.text.substring(0, 500));
    return;
  }

  // Get the token from the DATA form (first one)
  const dataToken = csrfTokens[0];
  // Get the token from the global form (last one)
  const globalToken = csrfTokens[csrfTokens.length - 1];

  console.log(`  DATA token: ${dataToken?.substring(0, 30)}...`);
  console.log(`  Global token: ${globalToken?.substring(0, 30)}...`);

  // Step 3: POST to BBLResult with the search parameters
  // The JavaScript go_Submit() copies form values to hidden global form, then submits
  console.log("\n=== Step 3: POST to BBLResult ===");

  const formData: Record<string, string> = {
    __RequestVerificationToken: globalToken || dataToken || "",
    hid_borough: borough,
    hid_borough_name: "QUEENS",
    hid_block: block,
    hid_block_value: block,
    hid_lot: lot,
    hid_lot_value: lot.padStart(4, "0"),
    hid_unit: "",
    hid_selectdate: "To Current Date",
    hid_datefromm: "",
    hid_datefromd: "",
    hid_datefromy: "",
    hid_datetom: "",
    hid_datetod: "",
    hid_datetoy: "",
    hid_doctype: "",
    hid_doctype_name: "",
    hid_max_rows: "99",
    hid_page: "1",
    hid_ReqID: "",
    hid_SearchType: "BBL",
    hid_ISIntranet: "N",
    hid_sort: "",
  };

  const result = await fetchPost(`${BASE}/DS/DocumentSearch/BBLResult`, formData);
  console.log(`  Result page length: ${result.text.length}`);

  const $r = cheerio.load(result.text);
  const title = $r("title").text();
  console.log(`  Title: ${title}`);

  // Check if we got results
  const rows = $r("tr[style]");
  console.log(`  Result rows found: ${rows.length}`);

  if (rows.length === 0) {
    console.log("\n  Body preview:", result.text.substring(0, 1000));
    return;
  }

  // Parse each result row
  console.log("\n=== Parsed Documents ===");
  rows.each((i, row) => {
    const cells = $r(row).find("td");
    const crfn = $r(cells[2]).text().trim();
    const lot = $r(cells[3]).text().trim();
    const partial = $r(cells[4]).text().trim();
    const docDate = $r(cells[5]).text().trim();
    const recorded = $r(cells[6]).text().trim();
    const docType = $r(cells[7]).text().trim();
    const pages = $r(cells[8]).text().trim();
    const party1 = $r(cells[9]).text().trim();
    const party2 = $r(cells[10]).text().trim();
    const amount = $r(cells[14]).text().trim();

    console.log(`\n  [${i + 1}] ${docType}`);
    console.log(`      Date: ${docDate} | Recorded: ${recorded}`);
    console.log(`      Party1: ${party1}`);
    console.log(`      Party2: ${party2}`);
    console.log(`      Amount: $${amount} | CRFN: ${crfn}`);
  });

  // Analyze mortgages
  console.log("\n=== Mortgage Analysis ===");
  const mortgages: { date: string; party1: string; party2: string; amount: string; crfn: string }[] = [];
  const satisfactions: { date: string; party1: string; party2: string; crfn: string }[] = [];

  rows.each((_, row) => {
    const cells = $r(row).find("td");
    const docType = $r(cells[7]).text().trim();
    const docDate = $r(cells[5]).text().trim();
    const party1 = $r(cells[9]).text().trim();
    const party2 = $r(cells[10]).text().trim();
    const amount = $r(cells[14]).text().trim();
    const crfn = $r(cells[2]).text().trim();

    if (docType === "MORTGAGE") {
      mortgages.push({ date: docDate, party1, party2, amount, crfn });
    } else if (docType === "SATISFACTION OF MORTGAGE") {
      satisfactions.push({ date: docDate, party1, party2, crfn });
    }
  });

  console.log(`  Mortgages found: ${mortgages.length}`);
  mortgages.forEach((m, i) => {
    console.log(`    [${i + 1}] ${m.date} | ${m.party1} -> ${m.party2} | $${m.amount}`);
  });

  console.log(`  Satisfactions found: ${satisfactions.length}`);
  satisfactions.forEach((s, i) => {
    console.log(`    [${i + 1}] ${s.date} | ${s.party1} -> ${s.party2}`);
  });

  const activeMortgages = mortgages.length - satisfactions.length;
  console.log(`\n  Active mortgages (approx): ${activeMortgages}`);
  if (activeMortgages >= 2) {
    console.log("  *** DOUBLE MORTGAGE DETECTED ***");
  } else {
    console.log("  No double mortgage detected.");
  }
}

main().catch(console.error);

import * as cheerio from "cheerio";

const BASE = "https://websurrogates.nycourts.gov";

// Cookies from the user's browser session
const COOKIES = [
  "__cf_bm=9sVLu_4V6k6qTYDpEEGb_Byzv2Ctvex3wQuaDBZTbrs-1774824651-1.0.1.1-pVaVdSDsBFr8Vr6a6n2LfT9YFRLNsvCC4iYMu2olnqRTNmKYoA4.shvNuw4rdCzGAfXq7QHlb.UteyIiHKAwYkLDTNhlNn42R7Jmc0bwT0M",
  "__cflb=02DiuDDpEsn6zC6F5zvcctviWf6qbTfkG4wgfhPGJPCma",
  "cf_clearance=7NdWzfwB1DTXpBKvedpEm_NPPC3vDzgiEBFTmVSsb9E-1774824653-1.2.1.1-bVhEsa4sgqn4H69_eMfLdPWIty5a7Rtu_gwHSo6oqa9IVaPZpnQbGLgE0DW.6HbggGL199KQv_J9QKSY5URz2w8tkRw8Kvp.FSoBUHnQpYR913DKp2tpfJ_FqSu.Y.oA_T3JETYVP4lITOZevcYEGaWFr5mfKU7XZpUUn6SV4ugbr_8z_9r_Ml2rXOZH8tt435NHXji9z2YsQCegI8pD2O3ePk0IuYl.QaxmJIj_Gz95saaUA5707jY3WJMs_7GR",
  "ARRAffinity=86c8e5986fea69b1b779af8bca1ab93a41b31587b3dbd746f80e391e3c8be33f",
  "ARRAffinitySameSite=86c8e5986fea69b1b779af8bca1ab93a41b31587b3dbd746f80e391e3c8be33f",
].join("; ");

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
  Cookie: COOKIES,
};

async function test() {
  // Step 1: GET search page with cf_clearance cookie
  console.log("GET /Names/NameSearch with cf_clearance cookie...");
  const page = await fetch(`${BASE}/Names/NameSearch`, {
    headers: HEADERS,
    redirect: "follow",
  });
  const html = await page.text();
  console.log(`Status: ${page.status}, HTML: ${html.length} chars`);
  console.log(`Just a moment: ${html.includes("Just a moment")}`);
  console.log(`Has form: ${html.includes("__RequestVerificationToken")}`);

  if (html.includes("Just a moment")) {
    console.log("Cookie expired or invalid.");
    return;
  }

  // Extract CSRF + session cookies
  const newCookies = new Map<string, string>();
  // Start with existing cookies
  COOKIES.split("; ").forEach(c => {
    const eq = c.indexOf("=");
    if (eq > 0) newCookies.set(c.slice(0, eq), c.slice(eq + 1));
  });
  // Add new cookies from response
  const setCookies = page.headers.getSetCookie?.() ?? [];
  for (const sc of setCookies) {
    const eq = sc.indexOf("=");
    const semi = sc.indexOf(";");
    if (eq > 0) newCookies.set(sc.slice(0, eq).trim(), sc.slice(eq + 1, semi > 0 ? semi : undefined).trim());
  }
  const allCookies = Array.from(newCookies.entries()).map(([k, v]) => `${k}=${v}`).join("; ");

  const $ = cheerio.load(html);
  const token = $('input[name="__RequestVerificationToken"]').val() as string;
  console.log(`CSRF token: ${token ? token.substring(0, 40) + "..." : "NOT FOUND"}`);

  if (!token) return;

  // Step 2: POST search — LONDON, IRETA in Bronx (court=3)
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
      Cookie: allCookies,
      Referer: `${BASE}/Names/NameSearch`,
      Origin: BASE,
    },
    body: form.toString(),
    redirect: "follow",
  });
  const resultHtml = await resp.text();
  console.log(`Status: ${resp.status}, HTML: ${resultHtml.length} chars`);

  const noMatch = resultHtml.includes("No Matching Files Were Found");
  console.log(`No match: ${noMatch}`);

  if (!noMatch) {
    console.log("Found results!");
    const $r = cheerio.load(resultHtml);
    $r("table tr").each((i, row) => {
      const text = $r(row).text().replace(/\s+/g, " ").trim();
      if (text && i < 20) console.log(`  Row ${i}: ${text.substring(0, 200)}`);
    });
  } else {
    console.log("No estate proceedings found for LONDON, IRETA.");
  }
}

test().catch((e) => console.error("Error:", e.message));

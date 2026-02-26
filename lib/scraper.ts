import * as cheerio from "cheerio";
import type { PropertyData } from "./types";

const BASE_URL = "https://a836-pts-access.nyc.gov/CARE";

const HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Upgrade-Insecure-Requests": "1",
};

/** Manual cookie jar - stores cookies as name=value, keyed by name */
class CookieJar {
  private cookies = new Map<string, string>();

  set(name: string, value: string) {
    this.cookies.set(name, value);
  }

  /** Parse Set-Cookie headers from a response */
  absorb(response: Response) {
    const setCookies = response.headers.getSetCookie?.() ?? [];
    for (const sc of setCookies) {
      const parts = sc.split(";")[0]; // name=value
      const eqIdx = parts.indexOf("=");
      if (eqIdx > 0) {
        this.cookies.set(parts.slice(0, eqIdx).trim(), parts.slice(eqIdx + 1).trim());
      }
    }
  }

  /** Return Cookie header string */
  toString(): string {
    return Array.from(this.cookies.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
  }
}

function getAspTokens($: cheerio.CheerioAPI): Record<string, string> {
  const tokens: Record<string, string> = {};
  for (const name of [
    "__VIEWSTATE",
    "__VIEWSTATEGENERATOR",
    "__EVENTVALIDATION",
    "__EVENTTARGET",
    "__EVENTARGUMENT",
  ]) {
    const el = $(`input[name="${name}"]`);
    if (el.length) {
      tokens[name] = el.attr("value") ?? "";
    }
  }
  return tokens;
}

function getAllHiddenFields($: cheerio.CheerioAPI): Record<string, string> {
  const fields: Record<string, string> = {};
  $('input[type="hidden"]').each((_, el) => {
    const name = $(el).attr("name");
    if (name) {
      fields[name] = $(el).attr("value") ?? "";
    }
  });
  return fields;
}

export function parsePropertyData(html: string): PropertyData {
  const $ = cheerio.load(html);
  const result: PropertyData = {
    address: null,
    borough: null,
    block: null,
    lot: null,
    owner_name: null,
    property_owners: [],
    property_address: null,
    billing_name: null,
    billing_address_lines: [],
    tax_class: null,
    building_class: null,
    market_value_land: null,
    market_value_total: null,
    assessed_value: null,
  };

  // Parse header
  $("td.DataletHeaderBottom").each((_, el) => {
    const text = $(el).text().trim();
    if (text && !text.includes("Borough:") && !text.includes("Block:")) {
      result.address = text;
    }
    if (text.includes("Borough:")) {
      result.borough = text.replace("Borough:", "").trim();
    }
    if (text.includes("Block:")) {
      const match = text.match(/Block:\s*(\d+)\s*Lot:\s*(\d+)/);
      if (match) {
        result.block = match[1];
        result.lot = match[2];
      }
    }
  });

  // Parse property owners
  const ownersDiv = $('div[name="OWNERS"]');
  if (ownersDiv.length) {
    ownersDiv.find("td.DataletData").each((_, el) => {
      const name = $(el).text().trim();
      if (name) result.property_owners.push(name);
    });
  }

  // Parse data rows - state machine for billing address
  let billingMode = false;
  $("tr").each((_, row) => {
    const cells = $(row).find("td");
    if (cells.length < 2) return;

    const heading = $(cells[0]).text().trim();
    const value = $(cells[1]).text().trim();

    if (heading === "Owner Name") {
      result.owner_name = value;
    } else if (heading === "Property Address") {
      result.property_address = value;
    } else if (heading === "Billing Name and Address") {
      result.billing_name = value;
      billingMode = true;
      return; // continue
    } else if (heading === "Tax Class") {
      result.tax_class = value;
      billingMode = false;
    } else if (heading === "Building Class") {
      result.building_class = value;
      billingMode = false;
    } else if (billingMode && (heading === "" || heading === "\u00a0")) {
      if (value && value !== "\u00a0") {
        result.billing_address_lines.push(value);
      }
    } else if (heading !== "" && heading !== "\u00a0") {
      billingMode = false;
    }

    // Assessment info (4-column rows)
    if (cells.length >= 4) {
      const desc = $(cells[1]).text().trim();
      if (desc.includes("ESTIMATED MARKET VALUE")) {
        result.market_value_land = $(cells[2]).text().trim();
        result.market_value_total = $(cells[3]).text().trim();
      }
    }
  });

  // Taxable assessed value
  $("tr").each((_, row) => {
    const cells = $(row).find("td");
    if (cells.length === 2) {
      const text = $(cells[0]).text().trim();
      if (text.includes("Taxes Will Be Based On")) {
        result.assessed_value = $(cells[1]).text().trim();
      }
    }
  });

  return result;
}

export class NYCPropertyScraper {
  private jar = new CookieJar();
  private sIndex = 0;
  private idx = 1;
  private signal?: AbortSignal;

  constructor(signal?: AbortSignal) {
    this.signal = signal;
  }

  private async fetchGet(url: string): Promise<{ text: string; url: string }> {
    // Manual redirect loop to preserve cookies
    let currentUrl = url;
    for (let i = 0; i < 10; i++) {
      const resp = await fetch(currentUrl, {
        headers: { ...HEADERS, Cookie: this.jar.toString() },
        redirect: "manual",
        signal: this.signal,
      });
      this.jar.absorb(resp);

      if (resp.status >= 300 && resp.status < 400) {
        const location = resp.headers.get("location");
        if (location) {
          currentUrl = location.startsWith("http")
            ? location
            : new URL(location, currentUrl).href;
          continue;
        }
      }

      if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${currentUrl}`);
      return { text: await resp.text(), url: currentUrl };
    }
    throw new Error("Too many redirects");
  }

  private async fetchPost(
    url: string,
    data: Record<string, string>
  ): Promise<{ text: string; url: string }> {
    const body = new URLSearchParams(data).toString();
    let currentUrl = url;
    let currentBody: string | undefined = body;
    let currentMethod = "POST";

    for (let i = 0; i < 10; i++) {
      const resp = await fetch(currentUrl, {
        method: currentMethod,
        headers: {
          ...HEADERS,
          Cookie: this.jar.toString(),
          ...(currentMethod === "POST"
            ? { "Content-Type": "application/x-www-form-urlencoded" }
            : {}),
        },
        body: currentMethod === "POST" ? currentBody : undefined,
        redirect: "manual",
        signal: this.signal,
      });
      this.jar.absorb(resp);

      if (resp.status >= 300 && resp.status < 400) {
        const location = resp.headers.get("location");
        if (location) {
          currentUrl = location.startsWith("http")
            ? location
            : new URL(location, currentUrl).href;
          // After redirect, switch to GET
          currentMethod = "GET";
          currentBody = undefined;
          continue;
        }
      }

      if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${currentUrl}`);
      return { text: await resp.text(), url: currentUrl };
    }
    throw new Error("Too many redirects");
  }

  private acceptDisclaimer() {
    this.jar.set("DISCLAIMER", "1");
  }

  private captureSearchIndex(url: string) {
    const sMatch = url.match(/sIndex=(\d+)/);
    if (sMatch) this.sIndex = parseInt(sMatch[1]);
    const iMatch = url.match(/idx=(\d+)/);
    if (iMatch) this.idx = parseInt(iMatch[1]);
  }

  private async followSearchResults(resp: {
    text: string;
    url: string;
  }): Promise<{ text: string; url: string }> {
    if (resp.url.toLowerCase().includes("datalet.aspx")) {
      this.captureSearchIndex(resp.url);
      return resp;
    }

    const $ = cheerio.load(resp.text);

    if (
      resp.text.includes("No records found") ||
      resp.text.includes("Your search did not find any records")
    ) {
      throw new Error("No properties found matching the search criteria");
    }

    // Search result rows with onclick
    const resultRows = $("tr[class*='SearchResults']");
    if (resultRows.length) {
      const onclick = resultRows.first().attr("onclick") ?? "";
      const urlMatch = onclick.match(/selectSearchRow\('([^']+)'\)/);
      if (urlMatch) {
        let href = urlMatch[1];
        if (href.startsWith("../")) {
          href = `${BASE_URL}/${href.slice(3)}`;
        } else if (!href.startsWith("http")) {
          href = `${BASE_URL}/search/${href}`;
        }
        const result = await this.fetchGet(href);
        this.captureSearchIndex(result.url);
        return result;
      }
    }

    // Fallback: direct datalet links
    const dataletLinks = $("a[href*='datalet' i]");
    if (dataletLinks.length) {
      let href = dataletLinks.first().attr("href") ?? "";
      if (href.startsWith("../")) {
        href = `${BASE_URL}/${href.slice(3)}`;
      } else if (!href.startsWith("http")) {
        href = `${BASE_URL}/search/${href}`;
      }
      const result = await this.fetchGet(href);
      this.captureSearchIndex(result.url);
      return result;
    }

    throw new Error("No properties found matching the search criteria");
  }

  async searchByAddress(
    houseNumber: string,
    street: string,
    borough?: string
  ): Promise<{ text: string; url: string }> {
    this.acceptDisclaimer();

    const searchUrl = `${BASE_URL}/search/commonsearch.aspx?mode=address`;
    const resp = await this.fetchGet(searchUrl);
    const $ = cheerio.load(resp.text);

    const formData: Record<string, string> = {
      ...getAllHiddenFields($),
      ...getAspTokens($),
      inpNumber: houseNumber,
      inpStreet: street,
      btSearch: "Search",
      hdAction: "search",
    };

    if (borough) {
      formData["inpUnit"] = borough;
    }

    const postResp = await this.fetchPost(searchUrl, formData);
    return this.followSearchResults(postResp);
  }

  async getAssessmentDatalet(
    mode?: string,
    sIndex?: number,
    idx?: number
  ): Promise<{ text: string; url: string }> {
    const m = mode ?? process.env.SCRAPER_ASSESSMENT_MODE ?? "asmt_tent_2027";
    const si = sIndex ?? this.sIndex;
    const ix = idx ?? this.idx;
    const url = `${BASE_URL}/datalets/datalet.aspx?mode=${m}&sIndex=${si}&idx=${ix}&LMparent=20`;
    return this.fetchGet(url);
  }

  async getPropertyDataByAddress(
    houseNumber: string,
    street: string,
    borough?: string
  ): Promise<PropertyData> {
    await this.searchByAddress(houseNumber, street, borough);
    const resp = await this.getAssessmentDatalet();
    return parsePropertyData(resp.text);
  }
}

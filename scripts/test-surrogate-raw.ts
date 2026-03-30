// Try to pass Cloudflare with just fetch + full browser headers

async function test() {
  const url = "https://websurrogates.nycourts.gov/Names/NameSearch";

  const resp = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Accept-Encoding": "gzip, deflate, br",
      "Upgrade-Insecure-Requests": "1",
      "sec-ch-ua": '"Chromium";v="146", "Not-A.Brand";v="24", "Google Chrome";v="146"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"Windows"',
      "sec-fetch-dest": "document",
      "sec-fetch-mode": "navigate",
      "sec-fetch-site": "none",
      "sec-fetch-user": "?1",
      "Cache-Control": "max-age=0",
    },
    redirect: "follow",
  });

  console.log("Status:", resp.status);
  console.log("URL:", resp.url);
  const text = await resp.text();
  console.log("Length:", text.length);
  console.log("Just a moment:", text.includes("Just a moment"));
  console.log("Has form:", text.includes("__RequestVerificationToken"));

  if (text.includes("Just a moment")) {
    // What type of challenge?
    console.log("\nChallenge type:");
    console.log("  Turnstile:", text.includes("turnstile"));
    console.log("  Challenge platform:", text.includes("challenge-platform"));
    console.log("  cf-chl-widget:", text.includes("cf-chl-widget"));
    console.log("  Managed challenge:", text.includes("managed"));

    // Extract the challenge script URL
    const scriptMatch = text.match(/src="([^"]*challenge[^"]*)"/);
    if (scriptMatch) console.log("  Challenge script:", scriptMatch[1]);
  }
}

test().catch((e) => console.error("Error:", e.message));

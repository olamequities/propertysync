"""Test surrogate court with patchright (patched Playwright that bypasses Cloudflare)."""
import asyncio
from patchright.async_api import async_playwright


async def test():
    print("Launching patchright browser...")
    pw = await async_playwright().start()
    browser = await pw.chromium.launch(headless=False)
    page = await browser.new_page()

    print("Navigating to surrogate court...")
    await page.goto("https://websurrogates.nycourts.gov/Names/NameSearch", wait_until="commit", timeout=60000)
    await page.wait_for_timeout(3000)

    title = await page.title()
    print(f"Title: {title}")

    if "moment" in title:
        print("Cloudflare challenge detected. Waiting up to 30s...")
        try:
            await page.wait_for_function("() => !document.title.includes('moment')", timeout=30000)
            print(f"Challenge PASSED! Title: {await page.title()}")
            # Wait for page to fully load after challenge
            await page.wait_for_load_state("networkidle", timeout=15000)
            await page.wait_for_timeout(2000)
        except:
            print("Challenge did NOT resolve.")
            await browser.close()
            await pw.stop()
            return

    # After Cloudflare, we may be on welcome page — need to accept terms
    print(f"Current URL: {page.url}")
    if "Welcome" in page.url or "/Names/NameSearch" not in page.url:
        print("On welcome page. Looking for accept/continue button...")
        # Log all buttons and links on the page
        links = await page.evaluate("""() => {
            const els = [...document.querySelectorAll('a, button, input[type=submit]')];
            return els.map(e => ({ tag: e.tagName, text: (e.innerText || e.value || '').trim(), href: e.href || '' }));
        }""")
        for l in links:
            print(f"  {l['tag']}: '{l['text']}' -> {l['href']}")

        # Try clicking any accept/agree/continue/start button
        # Click "Start Search" which goes to AuthenticatePage (another Cloudflare check)
        btn = page.locator("button:has-text('Start Search')")
        if await btn.count() > 0:
            print("Clicking 'Start Search'...")
            await btn.first.click()
            await page.wait_for_timeout(3000)
            print(f"Now at: {page.url}, Title: {await page.title()}")

            # Wait for AuthenticatePage challenge to resolve
            if "Authenticate" in page.url or "moment" in await page.title():
                print("Authentication/challenge page. Waiting up to 30s...")
                try:
                    await page.wait_for_url("**/Names/**", timeout=30000)
                    print(f"Authenticated! Now at: {page.url}")
                except:
                    # Try waiting for title change
                    try:
                        await page.wait_for_function("() => !document.title.includes('moment')", timeout=15000)
                        await page.wait_for_timeout(3000)
                        print(f"After auth: {page.url}, Title: {await page.title()}")
                    except:
                        print("Authentication did not resolve.")

        # Final attempt to get to search page
        if "/Names/NameSearch" not in page.url:
            print("Navigating to search page...")
            await page.goto("https://websurrogates.nycourts.gov/Names/NameSearch", wait_until="domcontentloaded", timeout=15000)
            await page.wait_for_timeout(3000)
            print(f"Now at: {page.url}")

    has_token = await page.evaluate("() => !!document.querySelector('input[name=__RequestVerificationToken]')")
    print(f"Has CSRF token: {has_token}")

    if not has_token:
        print("No form found. Exiting.")
        await browser.close()
        await pw.stop()
        return

    # Search: LONDON, IRETA in Bronx (court=3)
    print("\nSearching: LONDON, IRETA in Bronx...")
    await page.wait_for_selector("#CourtSelect", timeout=10000)
    await page.select_option("#CourtSelect", "3")
    await page.wait_for_timeout(500)
    await page.evaluate("() => { document.getElementById('LastNameBox').value = ''; document.getElementById('FirstNameBox').value = ''; }")
    await page.fill("#LastNameBox", "LONDON")
    await page.fill("#FirstNameBox", "IRETA")
    await page.click("#NameSearchSubmitName")
    await page.wait_for_load_state("domcontentloaded")
    await page.wait_for_timeout(3000)

    content = await page.content()
    no_match = "No Matching Files Were Found" in content
    print(f"No match: {no_match}")

    if not no_match:
        print("FOUND RESULTS:")
        rows = await page.evaluate("""() => {
            return Array.from(document.querySelectorAll('table tr'))
                .slice(0, 15)
                .map(tr => tr.innerText.replace(/\\s+/g, ' ').trim());
        }""")
        for i, r in enumerate(rows):
            if r:
                print(f"  Row {i}: {r[:250]}")
    else:
        print("No estate proceedings found.")

    # Search: HOUSE, THOMAS
    print("\n--- HOUSE, THOMAS in Bronx ---")
    await page.goto("https://websurrogates.nycourts.gov/Names/NameSearch", wait_until="domcontentloaded", timeout=30000)
    if "moment" in await page.title():
        await page.wait_for_function("() => !document.title.includes('moment')", timeout=30000)
    await page.wait_for_selector("#CourtSelect", timeout=10000)
    await page.select_option("#CourtSelect", "3")
    await page.wait_for_timeout(500)
    await page.fill("#LastNameBox", "HOUSE")
    await page.fill("#FirstNameBox", "THOMAS")
    await page.click("#NameSearchSubmitName")
    await page.wait_for_load_state("domcontentloaded")
    await page.wait_for_timeout(3000)

    content2 = await page.content()
    no_match2 = "No Matching Files Were Found" in content2
    print(f"No match: {no_match2}")

    if not no_match2:
        print("FOUND RESULTS:")
        rows2 = await page.evaluate("""() => {
            return Array.from(document.querySelectorAll('table tr'))
                .slice(0, 15)
                .map(tr => tr.innerText.replace(/\\s+/g, ' ').trim());
        }""")
        for i, r in enumerate(rows2):
            if r:
                print(f"  Row {i}: {r[:250]}")

    await browser.close()
    await pw.stop()
    print("\nDone.")


asyncio.run(test())

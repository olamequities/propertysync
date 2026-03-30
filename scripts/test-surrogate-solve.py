"""Use patchright to pass Cloudflare + solve the Turnstile on AuthenticatePage."""
import asyncio
from patchright.async_api import async_playwright


async def test():
    print("Launching patchright...")
    pw = await async_playwright().start()
    browser = await pw.chromium.launch(headless=False)
    page = await browser.new_page()

    # Step 1: Go to the site, pass initial Cloudflare
    print("Step 1: Navigate to surrogate court...")
    await page.goto("https://websurrogates.nycourts.gov/Names/NameSearch", wait_until="commit", timeout=60000)
    await page.wait_for_timeout(5000)
    print(f"  Title: {await page.title()}, URL: {page.url}")

    # Step 2: Click Start Search to go to AuthenticatePage
    if "Welcome" in page.url:
        print("Step 2: On welcome page, clicking Start Search...")
        btn = page.locator("button:has-text('Start Search')")
        if await btn.count() > 0:
            await btn.first.click()
            await page.wait_for_timeout(5000)
            print(f"  Now at: {page.url}")

    # Step 3: On AuthenticatePage — check what's there
    if "Authenticate" in page.url:
        print("Step 3: On AuthenticatePage. Examining page...")
        content = await page.content()
        print(f"  HTML length: {len(content)}")
        print(f"  Has Turnstile: {'turnstile' in content.lower()}")
        print(f"  Has cf-challenge: {'cf-challenge' in content}")
        print(f"  Has iframe: {'iframe' in content.lower()}")

        # Check for Turnstile iframe
        frames = page.frames
        print(f"  Frames: {len(frames)}")
        for i, f in enumerate(frames):
            print(f"    Frame {i}: {f.url}")

        # Wait longer — Turnstile might auto-solve
        print("  Waiting 20s for Turnstile to auto-solve...")
        await page.wait_for_timeout(20000)
        print(f"  After wait: URL={page.url}, Title={await page.title()}")

        # Check if we moved past auth
        if "Authenticate" not in page.url:
            print("  Authentication resolved!")
        else:
            # Try clicking the Turnstile checkbox if present
            print("  Still on auth page. Trying to click Turnstile...")
            try:
                turnstile_frame = None
                for f in page.frames:
                    if "challenges.cloudflare.com" in f.url:
                        turnstile_frame = f
                        break

                if turnstile_frame:
                    print(f"  Found Turnstile frame: {turnstile_frame.url}")
                    checkbox = turnstile_frame.locator("input[type='checkbox']")
                    if await checkbox.count() > 0:
                        await checkbox.click()
                        await page.wait_for_timeout(10000)
                        print(f"  After click: URL={page.url}")
                else:
                    print("  No Turnstile frame found")

                    # Try clicking any visible element that might be the challenge
                    challenge_div = page.locator(".cf-turnstile, [data-sitekey], iframe")
                    if await challenge_div.count() > 0:
                        print(f"  Found challenge element, clicking...")
                        await challenge_div.first.click()
                        await page.wait_for_timeout(10000)
                        print(f"  After click: URL={page.url}")
            except Exception as e:
                print(f"  Click error: {e}")

    # Step 4: Try to reach search page
    print(f"\nStep 4: Current URL: {page.url}")
    if "/Names/NameSearch" not in page.url:
        print("  Navigating to search...")
        await page.goto("https://websurrogates.nycourts.gov/Names/NameSearch", wait_until="domcontentloaded", timeout=15000)
        await page.wait_for_timeout(3000)

    print(f"  Final URL: {page.url}")
    has_court = await page.locator("#CourtSelect").count()
    print(f"  Has CourtSelect: {has_court > 0}")

    if has_court > 0:
        print("\n=== SUCCESS! Search page reached. Testing search... ===")
        await page.select_option("#CourtSelect", "3")
        await page.fill("#LastNameBox", "LONDON")
        await page.fill("#FirstNameBox", "IRETA")
        await page.click("#NameSearchSubmitName")
        await page.wait_for_load_state("domcontentloaded")
        await page.wait_for_timeout(3000)

        no_match = "No Matching Files Were Found" in await page.content()
        print(f"  No match: {no_match}")
        if not no_match:
            rows = await page.evaluate("""() => Array.from(document.querySelectorAll('table tr')).slice(0,10).map(r => r.innerText.replace(/\\s+/g,' ').trim())""")
            for i, r in enumerate(rows):
                if r:
                    print(f"  Row {i}: {r[:200]}")

    await browser.close()
    await pw.stop()
    print("\nDone.")


asyncio.run(test())

"""Quick test: SeleniumBase UC mode + hCaptcha on surrogate court."""
from seleniumbase import SB

CHROME = "/home/lchira99/.local/lib/python3.10/site-packages/seleniumbase/drivers/cft_drivers/chrome-linux64/chrome"

with SB(uc=True, test=True, binary_location=CHROME) as sb:
    url = "https://websurrogates.nycourts.gov/Names/NameSearch"
    sb.activate_cdp_mode(url)
    sb.sleep(5)
    print(f"1. Title: {sb.cdp.get_title()}, URL: {sb.get_current_url()}")

    # Handle Cloudflare if needed
    if "moment" in sb.cdp.get_title().lower():
        print("   CF challenge. Clicking...")
        sb.uc_gui_click_captcha()
        sb.sleep(8)
        print(f"   After CF: {sb.cdp.get_title()}")

    # Welcome page — click Start Search
    if "Welcome" in sb.get_current_url():
        print("\n2. Welcome page. Clicking Start Search...")
        sb.cdp.click("button:contains('Start Search')")
        sb.sleep(5)
        print(f"   URL: {sb.get_current_url()}")

    # hCaptcha on AuthenticatePage — try multiple times
    for attempt in range(5):
        if "Authenticate" not in sb.get_current_url():
            break
        print(f"\n3. hCaptcha solve attempt {attempt + 1}...")
        try:
            sb.solve_captcha()
        except Exception as e:
            print(f"   solve_captcha error: {e}")
        sb.sleep(5)
        print(f"   URL: {sb.get_current_url()}")

    # Try navigating to search
    if "/Names/NameSearch" not in sb.get_current_url():
        print("\n4. Navigating to search page...")
        sb.activate_cdp_mode(url)
        sb.sleep(5)

    print(f"\nFinal URL: {sb.get_current_url()}")
    print(f"Final Title: {sb.cdp.get_title()}")

    # Check for form
    source = sb.get_page_source()
    has_form = "CourtSelect" in source
    print(f"Has search form: {has_form}")

    if has_form:
        print("\n=== SUCCESS! Running search... ===")
        sb.reconnect()
        sb.sleep(2)
        sb.select_option_by_value("#CourtSelect", "3")
        sb.type("#LastNameBox", "LONDON")
        sb.type("#FirstNameBox", "IRETA")
        sb.click("#NameSearchSubmitName")
        sb.sleep(4)

        if "No Matching Files Were Found" in sb.get_page_source():
            print("  No estate proceedings found for LONDON, IRETA")
        else:
            print("  ESTATE FOUND!")
            rows = sb.find_elements("table tr")
            for i, row in enumerate(rows[:10]):
                t = row.text.strip()
                if t:
                    print(f"    Row {i}: {t[:250]}")

"""Test surrogate court with SeleniumBase UC mode + CDP solve_captcha."""
from seleniumbase import SB

CHROME = "/home/lchira99/.local/lib/python3.10/site-packages/seleniumbase/drivers/cft_drivers/chrome-linux64/chrome"

def test():
    with SB(uc=True, test=True, binary_location=CHROME) as sb:
        url = "https://websurrogates.nycourts.gov/Names/NameSearch"
        print("Step 1: Navigate...")
        sb.activate_cdp_mode(url)
        sb.sleep(5)
        print(f"  Title: {sb.cdp.get_title()}")
        print(f"  URL: {sb.get_current_url()}")

        # Handle Cloudflare "Just a moment"
        for attempt in range(3):
            title = sb.cdp.get_title()
            if "moment" not in title.lower():
                break
            print(f"  Cloudflare challenge (attempt {attempt+1}). Waiting...")
            sb.sleep(8)

        print(f"  After CF: Title={sb.cdp.get_title()}, URL={sb.get_current_url()}")

        # Handle Welcome page — click "Start Search"
        if "Welcome" in sb.get_current_url():
            print("\nStep 2: Welcome page. Clicking Start Search...")
            sb.cdp.click("button:contains('Start Search')")
            sb.sleep(5)
            print(f"  URL: {sb.get_current_url()}")

        # Handle AuthenticatePage with hCaptcha
        if "Authenticate" in sb.get_current_url():
            print("\nStep 3: hCaptcha page. Solving...")
            sb.solve_captcha()
            sb.sleep(5)
            print(f"  After solve: URL={sb.get_current_url()}")

            # May need to solve again or wait
            if "Authenticate" in sb.get_current_url():
                print("  Still on auth. Trying again...")
                sb.solve_captcha()
                sb.sleep(5)
                print(f"  URL: {sb.get_current_url()}")

        # Navigate to search if needed
        current = sb.get_current_url()
        if "/Names/NameSearch" not in current:
            print("\nNavigating to search page...")
            sb.activate_cdp_mode(url)
            sb.sleep(5)
            print(f"  URL: {sb.get_current_url()}")

        # Check for search form
        print(f"\nFinal URL: {sb.get_current_url()}")

        # Switch back to regular mode for form interaction
        sb.reconnect()
        sb.sleep(2)

        if sb.is_element_present("#CourtSelect"):
            print("\n=== SEARCH PAGE REACHED! ===")

            # Search: LONDON, IRETA in Bronx
            print("\nSearching: LONDON, IRETA in Bronx...")
            sb.select_option_by_value("#CourtSelect", "3")
            sb.type("#LastNameBox", "LONDON")
            sb.type("#FirstNameBox", "IRETA")
            sb.click("#NameSearchSubmitName")
            sb.sleep(4)

            source = sb.get_page_source()
            if "No Matching Files Were Found" in source:
                print("  Result: No estate proceedings found.")
            else:
                print("  Result: ESTATE FOUND!")
                rows = sb.find_elements("table tr")
                for i, row in enumerate(rows[:15]):
                    text = row.text.strip()
                    if text:
                        print(f"    Row {i}: {text[:250]}")

            # Search: HOUSE, THOMAS
            print("\n--- HOUSE, THOMAS in Bronx ---")
            sb.open("https://websurrogates.nycourts.gov/Names/NameSearch")
            sb.sleep(2)
            if sb.is_element_present("#CourtSelect"):
                sb.select_option_by_value("#CourtSelect", "3")
                sb.type("#LastNameBox", "HOUSE")
                sb.type("#FirstNameBox", "THOMAS")
                sb.click("#NameSearchSubmitName")
                sb.sleep(4)

                source2 = sb.get_page_source()
                if "No Matching Files Were Found" in source2:
                    print("  Result: No estate proceedings found.")
                else:
                    print("  Result: ESTATE FOUND!")
                    rows2 = sb.find_elements("table tr")
                    for i, row in enumerate(rows2[:15]):
                        text = row.text.strip()
                        if text:
                            print(f"    Row {i}: {text[:250]}")
        else:
            print("Could not reach search page.")
            print(f"Page source snippet: {sb.get_page_source()[:500]}")

    print("\nDone.")

test()

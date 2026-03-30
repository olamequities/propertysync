"""Test surrogate court with SeleniumBase Stealthy Playwright mode."""
from seleniumbase import SB

def test():
    with SB(uc_cdp=True, test=True, headless=True) as sb:
        print("Navigating to surrogate court...")
        sb.activate_cdp_mode("https://websurrogates.nycourts.gov/Names/NameSearch")
        sb.sleep(5)
        print(f"Title: {sb.get_title()}")
        print(f"URL: {sb.get_current_url()}")

        # If on welcome page, click Start Search
        if "Welcome" in sb.get_current_url():
            print("On welcome page. Clicking Start Search...")
            sb.cdp.click("button:contains('Start Search')")
            sb.sleep(5)
            print(f"Now at: {sb.get_current_url()}")

        # Solve hCaptcha if present
        if "Authenticate" in sb.get_current_url():
            print("On authenticate page. Solving hCaptcha...")
            sb.solve_captcha()
            sb.sleep(5)
            print(f"After solve: {sb.get_current_url()}")

        # Navigate to search if needed
        if "/Names/NameSearch" not in sb.get_current_url():
            print("Navigating to search page...")
            sb.activate_cdp_mode("https://websurrogates.nycourts.gov/Names/NameSearch")
            sb.sleep(3)

        print(f"Final URL: {sb.get_current_url()}")

        if sb.is_element_visible("#CourtSelect"):
            print("\n=== SEARCH PAGE REACHED! ===")
            sb.select_option_by_value("#CourtSelect", "3")
            sb.type("#LastNameBox", "LONDON")
            sb.type("#FirstNameBox", "IRETA")
            sb.click("#NameSearchSubmitName")
            sb.sleep(3)

            if "No Matching Files Were Found" in sb.get_page_source():
                print("Result: No estate proceedings found.")
            else:
                print("Result: ESTATE FOUND!")
                rows = sb.find_elements("table tr")
                for i, row in enumerate(rows[:15]):
                    text = row.text.strip()
                    if text:
                        print(f"  Row {i}: {text[:200]}")
        else:
            print("Could not reach search page.")

    print("\nDone.")

test()

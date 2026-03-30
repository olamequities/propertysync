"""Use SeleniumBase uc_gui methods for hCaptcha — simulates real mouse via PyAutoGUI."""
from seleniumbase import SB
import pyautogui
import time

CHROME = "/home/lchira99/.local/lib/python3.10/site-packages/seleniumbase/drivers/cft_drivers/chrome-linux64/chrome"

with SB(uc=True, test=True, binary_location=CHROME) as sb:
    url = "https://websurrogates.nycourts.gov/Names/NameSearch"
    sb.activate_cdp_mode(url)
    sb.sleep(5)
    print(f"Title: {sb.cdp.get_title()}, URL: {sb.get_current_url()}")

    # Welcome page
    if "Welcome" in sb.get_current_url():
        print("Clicking Start Search...")
        sb.cdp.click("button:contains('Start Search')")
        sb.sleep(5)

    if "Authenticate" in sb.get_current_url():
        print(f"On AuthenticatePage. Finding hCaptcha checkbox...")

        # Get iframe position
        rect = sb.cdp.evaluate("""
            (() => {
                const iframes = document.querySelectorAll('iframe');
                for (let i = 0; i < iframes.length; i++) {
                    if (iframes[i].src.includes('checkbox')) {
                        const r = iframes[i].getBoundingClientRect();
                        return { x: r.x, y: r.y, width: r.width, height: r.height };
                    }
                }
                return null;
            })()
        """)
        print(f"Checkbox iframe rect: {rect}")

        if rect:
            # Use PyAutoGUI to simulate real mouse movement and click
            # The checkbox is at left side of iframe
            target_x = int(rect['x']) + 30
            target_y = int(rect['y'] + rect['height'] / 2)
            print(f"Target click: ({target_x}, {target_y})")

            # Move mouse slowly to target (simulates human movement)
            current_x, current_y = pyautogui.position()
            print(f"Current mouse: ({current_x}, {current_y})")

            # Move to target with human-like movement
            pyautogui.moveTo(target_x, target_y, duration=0.5)
            time.sleep(0.3)

            # Click
            pyautogui.click(target_x, target_y)
            print("PyAutoGUI click sent!")
            time.sleep(10)
            print(f"URL after click: {sb.get_current_url()}")

            # If still on auth, try uc_gui_click_captcha
            if "Authenticate" in sb.get_current_url():
                print("Still on auth. Trying uc_gui_click_captcha()...")
                try:
                    sb.uc_gui_click_captcha()
                    time.sleep(8)
                except Exception as e:
                    print(f"  Error: {e}")
                print(f"URL: {sb.get_current_url()}")

    # Final result
    print(f"\nFinal URL: {sb.get_current_url()}")
    print(f"Has search form: {'CourtSelect' in sb.get_page_source()}")

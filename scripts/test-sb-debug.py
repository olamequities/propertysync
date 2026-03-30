"""Debug: check what happens after clicking hCaptcha checkbox."""
from seleniumbase import SB
import pyautogui
import time

CHROME = "/home/lchira99/.local/lib/python3.10/site-packages/seleniumbase/drivers/cft_drivers/chrome-linux64/chrome"

with SB(uc=True, test=True, binary_location=CHROME) as sb:
    sb.activate_cdp_mode("https://websurrogates.nycourts.gov/Names/NameSearch")
    sb.sleep(5)

    if "Welcome" in sb.get_current_url():
        sb.cdp.click("button:contains('Start Search')")
        sb.sleep(5)

    if "Authenticate" in sb.get_current_url():
        # Click the checkbox
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
        print(f"Checkbox rect: {rect}")

        target_x = int(rect['x']) + 30
        target_y = int(rect['y'] + rect['height'] / 2)

        pyautogui.moveTo(target_x, target_y, duration=0.5)
        time.sleep(0.2)
        pyautogui.click()
        print("Clicked checkbox. Waiting 5s...")
        time.sleep(5)

        # Check if challenge iframe appeared (image selection)
        challenge_visible = sb.cdp.evaluate("""
            (() => {
                const iframes = document.querySelectorAll('iframe');
                for (let i = 0; i < iframes.length; i++) {
                    if (iframes[i].src.includes('challenge')) {
                        const r = iframes[i].getBoundingClientRect();
                        return { visible: r.width > 0 && r.height > 0, x: r.x, y: r.y, w: r.width, h: r.height };
                    }
                }
                return { visible: false };
            })()
        """)
        print(f"Challenge iframe: {challenge_visible}")

        # Check hcaptcha response token
        token = sb.cdp.evaluate("document.querySelector('[name=h-captcha-response]')?.value || 'none'")
        print(f"hCaptcha token: {token[:50] if token != 'none' else 'none'}")

        # Check checkbox state
        checkbox_state = sb.cdp.evaluate("""
            (() => {
                const iframes = document.querySelectorAll('iframe');
                for (let i = 0; i < iframes.length; i++) {
                    if (iframes[i].src.includes('checkbox')) {
                        const r = iframes[i].getBoundingClientRect();
                        return { width: r.width, height: r.height, display: window.getComputedStyle(iframes[i]).display };
                    }
                }
                return null;
            })()
        """)
        print(f"Checkbox iframe state: {checkbox_state}")

        # Take a screenshot for debugging
        try:
            sb.save_screenshot("/tmp/hcaptcha_debug.png")
            print("Screenshot saved to /tmp/hcaptcha_debug.png")
        except:
            pass

        print(f"\nFinal URL: {sb.get_current_url()}")

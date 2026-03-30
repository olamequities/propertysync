"""Check what happens inside the hCaptcha iframe after clicking."""
import json
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
        # Before clicking — check hcaptcha response
        token_before = sb.cdp.evaluate("document.querySelector('[name=h-captcha-response]')?.value || 'empty'")
        print(f"Token before click: {token_before[:50] if token_before else 'none'}")

        # Check all form inputs
        inputs = sb.cdp.evaluate("""
            (() => {
                const inputs = document.querySelectorAll('input, textarea');
                return Array.from(inputs).map(i => ({name: i.name, type: i.type, value: (i.value || '').substring(0, 50)}));
            })()
        """)
        print(f"Form inputs: {json.dumps(inputs, indent=2) if inputs else 'none'}")

        # Click checkbox with PyAutoGUI
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

        if rect:
            tx = int(rect['x']) + 30
            ty = int(rect['y'] + rect['height'] / 2)
            print(f"\nClicking checkbox at ({tx}, {ty})...")
            pyautogui.moveTo(tx, ty, duration=0.5)
            time.sleep(0.3)
            pyautogui.click()
            time.sleep(8)

        # After clicking — check token again
        token_after = sb.cdp.evaluate("document.querySelector('[name=h-captcha-response]')?.value || 'empty'")
        print(f"\nToken after click: {token_after[:80] if token_after else 'none'}")

        if token_after and token_after != 'empty' and len(token_after) > 10:
            print("\n*** hCaptcha SOLVED! Token received! ***")
            print(f"Token length: {len(token_after)}")

            # Try submitting the form
            sb.reconnect()
            sb.sleep(1)

            # Find and submit the form
            try:
                sb.execute_script("document.querySelector('form')?.submit()")
                sb.sleep(5)
                print(f"After submit: {sb.get_current_url()}")
            except Exception as e:
                print(f"Submit error: {e}")
        else:
            print("\nNo token — hCaptcha not solved by checkbox click alone.")

            # Check challenge iframe position
            challenge = sb.cdp.evaluate("""
                (() => {
                    const iframes = document.querySelectorAll('iframe');
                    for (let i = 0; i < iframes.length; i++) {
                        if (iframes[i].src.includes('challenge')) {
                            const r = iframes[i].getBoundingClientRect();
                            const s = window.getComputedStyle(iframes[i]);
                            return { x: r.x, y: r.y, w: r.width, h: r.height, display: s.display, visibility: s.visibility, opacity: s.opacity };
                        }
                    }
                    return null;
                })()
            """)
            print(f"Challenge iframe state: {challenge}")

        print(f"\nFinal URL: {sb.get_current_url()}")

"""Manually solve hCaptcha using CDP dispatchMouseEvent on surrogate court."""
from seleniumbase import SB
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
        print(f"URL: {sb.get_current_url()}")

    if "Authenticate" in sb.get_current_url():
        print("\nOn AuthenticatePage. Examining hCaptcha...")

        # Get page content to find the hCaptcha
        source = sb.get_page_source()
        print(f"Has h-captcha: {'h-captcha' in source}")
        print(f"Has hcaptcha iframe: {'hcaptcha.com' in source}")
        print(f"Has data-sitekey: {'data-sitekey' in source}")

        # Find all iframes
        iframes = sb.cdp.find_elements("iframe")
        print(f"Iframes found: {len(iframes)}")
        for i, iframe in enumerate(iframes):
            src = sb.cdp.evaluate(f"document.querySelectorAll('iframe')[{i}].src")
            print(f"  iframe {i}: {src[:150] if src else 'no src'}")

        # Try to find and click the hCaptcha checkbox via CDP
        # The checkbox is inside an iframe from hcaptcha.com
        print("\nTrying to click hCaptcha checkbox via CDP...")

        # Method 1: Use sb.cdp to click within the hCaptcha iframe
        try:
            # Find the hCaptcha checkbox iframe
            checkbox_iframe = None
            for i, iframe in enumerate(iframes):
                src = sb.cdp.evaluate(f"document.querySelectorAll('iframe')[{i}].src") or ""
                if "hcaptcha" in src and "checkbox" in src:
                    checkbox_iframe = i
                    break

            if checkbox_iframe is not None:
                print(f"  Found checkbox iframe at index {checkbox_iframe}")

                # Get iframe position
                rect = sb.cdp.evaluate(f"""
                    (() => {{
                        const iframe = document.querySelectorAll('iframe')[{checkbox_iframe}];
                        const r = iframe.getBoundingClientRect();
                        return {{ x: r.x, y: r.y, width: r.width, height: r.height }};
                    }})()
                """)
                print(f"  Iframe rect: {rect}")

                # Click the checkbox (left side of iframe, vertically centered)
                click_x = rect['x'] + 30  # checkbox is on the left
                click_y = rect['y'] + rect['height'] / 2
                print(f"  Clicking at ({click_x}, {click_y})...")

                # Switch to selenium mode for CDP commands
                sb.reconnect()
                sb.sleep(1)

                x = int(click_x)
                y = int(click_y)
                print(f"  Sending CDP dispatchMouseEvent at ({x}, {y})...")

                # Move mouse to position first
                sb.execute_cdp_cmd("Input.dispatchMouseEvent", {
                    "type": "mouseMoved", "x": x, "y": y
                })
                time.sleep(0.3)

                # mousePressed
                sb.execute_cdp_cmd("Input.dispatchMouseEvent", {
                    "type": "mousePressed",
                    "x": x, "y": y,
                    "button": "left",
                    "clickCount": 1
                })
                time.sleep(0.1)

                # mouseReleased
                sb.execute_cdp_cmd("Input.dispatchMouseEvent", {
                    "type": "mouseReleased",
                    "x": x, "y": y,
                    "button": "left",
                    "clickCount": 1
                })
                print(f"  CDP click sent! Waiting 10s...")
                sb.sleep(10)
                print(f"  URL: {sb.get_current_url()}")

                # If still on auth, try again with slight offset
                if "Authenticate" in sb.get_current_url():
                    print("  Still on auth. Retrying with offset...")
                    for offset_x in [25, 35, 20]:
                        x2 = int(rect['x']) + offset_x
                        y2 = int(rect['y'] + rect['height'] / 2)
                        sb.execute_cdp_cmd("Input.dispatchMouseEvent", {"type": "mouseMoved", "x": x2, "y": y2})
                        time.sleep(0.2)
                        sb.execute_cdp_cmd("Input.dispatchMouseEvent", {"type": "mousePressed", "x": x2, "y": y2, "button": "left", "clickCount": 1})
                        time.sleep(0.1)
                        sb.execute_cdp_cmd("Input.dispatchMouseEvent", {"type": "mouseReleased", "x": x2, "y": y2, "button": "left", "clickCount": 1})
                        sb.sleep(5)
                        if "Authenticate" not in sb.get_current_url():
                            print(f"  Solved with offset {offset_x}!")
                            break
                    print(f"  URL: {sb.get_current_url()}")

            else:
                print("  No hCaptcha checkbox iframe found")

        except Exception as e:
            print(f"  Error: {e}")

    print(f"\nFinal URL: {sb.get_current_url()}")
    print(f"Has search form: {'CourtSelect' in sb.get_page_source()}")

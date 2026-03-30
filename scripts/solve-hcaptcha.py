"""
Solve hCaptcha on surrogate court using SeleniumBase + Claude Vision API.
Usage: ANTHROPIC_API_KEY=sk-... xvfb-run python3 scripts/solve-hcaptcha.py
"""
import os
import sys
import json
import time
import base64
import asyncio
import httpx
from seleniumbase import SB

CHROME = "/home/lchira99/.local/lib/python3.10/site-packages/seleniumbase/drivers/cft_drivers/chrome-linux64/chrome"
API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
if not API_KEY:
    print("Set ANTHROPIC_API_KEY env var")
    sys.exit(1)

BOROUGH_TO_COURT = {
    "bronx": "3", "brooklyn": "24", "kings": "24",
    "manhattan": "31", "new york": "31",
    "queens": "41", "staten island": "43", "richmond": "43",
}


def ask_claude_vision(image_base64: str, prompt: str) -> str:
    """Send an image to Claude and get a response."""
    resp = httpx.post(
        "https://api.anthropic.com/v1/messages",
        headers={
            "x-api-key": API_KEY,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        },
        json={
            "model": "claude-sonnet-4-20250514",
            "max_tokens": 1024,
            "messages": [{
                "role": "user",
                "content": [
                    {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": image_base64}},
                    {"type": "text", "text": prompt},
                ],
            }],
        },
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()["content"][0]["text"]


def solve_hcaptcha_challenge(sb) -> bool:
    """Attempt to solve the hCaptcha image challenge using Claude Vision."""
    # Find the challenge iframe
    challenge_rect = sb.cdp.evaluate("""
        (() => {
            const iframes = document.querySelectorAll('iframe');
            for (let i = 0; i < iframes.length; i++) {
                if (iframes[i].src.includes('challenge')) {
                    const r = iframes[i].getBoundingClientRect();
                    return { x: r.x, y: r.y, width: r.width, height: r.height, visible: r.height > 100 };
                }
            }
            return null;
        })()
    """)

    if not challenge_rect or not challenge_rect.get("visible"):
        print("  No visible challenge iframe")
        return False

    print(f"  Challenge iframe: {challenge_rect}")

    # Take screenshot of the entire page
    screenshot_path = "/tmp/hcaptcha_challenge.png"
    sb.save_screenshot(screenshot_path)

    with open(screenshot_path, "rb") as f:
        img_b64 = base64.b64encode(f.read()).decode()

    # Ask Claude to analyze the challenge
    prompt = """This is a screenshot of an hCaptcha image challenge.

I need you to:
1. Tell me what the challenge is asking (e.g., "select all images containing a bus")
2. Looking at the grid of images, tell me which cells to click. Number them 1-9 (or 1-16) left to right, top to bottom.

Respond in JSON format only:
{"task": "description of what to select", "cells": [1, 4, 7]}

If you can't see a clear challenge or images, respond: {"task": "unclear", "cells": []}"""

    print("  Asking Claude Vision to solve challenge...")
    try:
        response = ask_claude_vision(img_b64, prompt)
        print(f"  Claude response: {response}")

        # Parse the JSON from response
        # Find JSON in the response
        json_start = response.find("{")
        json_end = response.rfind("}") + 1
        if json_start >= 0 and json_end > json_start:
            result = json.loads(response[json_start:json_end])
        else:
            print("  Could not parse JSON from response")
            return False

        cells = result.get("cells", [])
        if not cells:
            print("  No cells to click")
            return False

        print(f"  Task: {result.get('task')}")
        print(f"  Clicking cells: {cells}")

        # We need to click inside the challenge iframe
        # First, get the grid layout inside the challenge
        # Switch to selenium mode for clicking
        sb.reconnect()
        sb.sleep(1)

        # The challenge iframe contains a grid. We need to calculate click positions.
        # hCaptcha typically has a 3x3 grid
        grid_cols = 3
        grid_rows = 3
        if max(cells) > 9:
            grid_cols = 4
            grid_rows = 4

        # The challenge area (images) is roughly in the center of the challenge iframe
        # Estimate the grid area within the challenge iframe
        cx = challenge_rect["x"]
        cy = challenge_rect["y"]
        cw = challenge_rect["width"]
        ch = challenge_rect["height"]

        # The image grid typically takes up most of the iframe, with some padding
        # and a header for the task description
        grid_top = cy + ch * 0.25  # skip header area
        grid_height = ch * 0.65
        grid_left = cx + cw * 0.05
        grid_width = cw * 0.9

        cell_w = grid_width / grid_cols
        cell_h = grid_height / grid_rows

        for cell_num in cells:
            row = (cell_num - 1) // grid_cols
            col = (cell_num - 1) % grid_cols
            click_x = int(grid_left + col * cell_w + cell_w / 2)
            click_y = int(grid_top + row * cell_h + cell_h / 2)

            print(f"  Clicking cell {cell_num} at ({click_x}, {click_y})...")
            sb.execute_cdp_cmd("Input.dispatchMouseEvent", {"type": "mouseMoved", "x": click_x, "y": click_y})
            time.sleep(0.2)
            sb.execute_cdp_cmd("Input.dispatchMouseEvent", {"type": "mousePressed", "x": click_x, "y": click_y, "button": "left", "clickCount": 1})
            time.sleep(0.1)
            sb.execute_cdp_cmd("Input.dispatchMouseEvent", {"type": "mouseReleased", "x": click_x, "y": click_y, "button": "left", "clickCount": 1})
            time.sleep(0.5)

        # Click the verify/submit button (usually at the bottom of challenge)
        verify_y = int(cy + ch * 0.93)
        verify_x = int(cx + cw / 2)
        print(f"  Clicking verify at ({verify_x}, {verify_y})...")
        time.sleep(1)
        sb.execute_cdp_cmd("Input.dispatchMouseEvent", {"type": "mouseMoved", "x": verify_x, "y": verify_y})
        time.sleep(0.2)
        sb.execute_cdp_cmd("Input.dispatchMouseEvent", {"type": "mousePressed", "x": verify_x, "y": verify_y, "button": "left", "clickCount": 1})
        time.sleep(0.1)
        sb.execute_cdp_cmd("Input.dispatchMouseEvent", {"type": "mouseReleased", "x": verify_x, "y": verify_y, "button": "left", "clickCount": 1})

        time.sleep(5)
        return True

    except Exception as e:
        print(f"  Claude Vision error: {e}")
        return False


def main():
    with SB(uc=True, test=True, binary_location=CHROME) as sb:
        print("=== Step 1: Navigate & pass Cloudflare ===")
        sb.activate_cdp_mode("https://websurrogates.nycourts.gov/Names/NameSearch")
        sb.sleep(5)
        print(f"Title: {sb.cdp.get_title()}, URL: {sb.get_current_url()}")

        # Welcome page
        if "Welcome" in sb.get_current_url():
            print("\n=== Step 2: Click Start Search ===")
            sb.cdp.click("button:contains('Start Search')")
            sb.sleep(5)
            print(f"URL: {sb.get_current_url()}")

        # hCaptcha
        if "Authenticate" in sb.get_current_url():
            print("\n=== Step 3: Solve hCaptcha ===")

            # Click the checkbox first
            import pyautogui
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
                target_x = int(rect['x']) + 30
                target_y = int(rect['y'] + rect['height'] / 2)
                print(f"Clicking checkbox at ({target_x}, {target_y})...")
                pyautogui.moveTo(target_x, target_y, duration=0.5)
                time.sleep(0.3)
                pyautogui.click()
                time.sleep(5)

            # Now try to solve the image challenge
            for attempt in range(3):
                print(f"\nSolve attempt {attempt + 1}...")
                if "Authenticate" not in sb.get_current_url():
                    print("hCaptcha solved!")
                    break

                # Re-activate CDP mode if needed
                try:
                    sb.activate_cdp_mode(sb.get_current_url())
                    sb.sleep(2)
                except:
                    pass

                solved = solve_hcaptcha_challenge(sb)
                if not solved:
                    print("  Could not solve challenge")
                    break

                sb.sleep(3)
                print(f"  URL after attempt: {sb.get_current_url()}")

        # Navigate to search
        print(f"\n=== Step 4: Search ===")
        current = sb.get_current_url()
        if "/Names/NameSearch" not in current:
            sb.activate_cdp_mode("https://websurrogates.nycourts.gov/Names/NameSearch")
            sb.sleep(3)

        print(f"URL: {sb.get_current_url()}")

        if "CourtSelect" in sb.get_page_source():
            print("Search page reached!")
            sb.reconnect()
            sb.sleep(2)

            # Test search
            sb.select_option_by_value("#CourtSelect", "3")
            sb.type("#LastNameBox", "LONDON")
            sb.type("#FirstNameBox", "IRETA")
            sb.click("#NameSearchSubmitName")
            sb.sleep(4)

            if "No Matching Files Were Found" in sb.get_page_source():
                print("  LONDON, IRETA: No estate proceedings")
            else:
                print("  LONDON, IRETA: ESTATE FOUND!")
                rows = sb.find_elements("table tr")
                for i, row in enumerate(rows[:10]):
                    t = row.text.strip()
                    if t:
                        print(f"    {t[:250]}")
        else:
            print("Could not reach search page.")


main()

"""
Estate Scanner - Surrogate Court Search (with API integration)
Launched by the portal via Electron, or run standalone.
Communicates progress back to the portal API.
"""
import os
import sys
import time
import json
import urllib.request
import urllib.error
from pathlib import Path
from seleniumbase import SB

# Load .env.local
env_path = Path(__file__).parent.parent / ".env.local"
if env_path.exists():
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, val = line.split("=", 1)
            os.environ.setdefault(key.strip(), val.strip())

BOROUGH_TO_COURT = {
    "bronx": "3", "brooklyn": "24", "kings": "24",
    "manhattan": "31", "new york": "31",
    "queens": "41", "staten island": "43", "richmond": "43",
}

API_BASE = os.environ.get("PORTAL_URL", "http://localhost:3000")
AUTH_COOKIE = os.environ.get("AUTH_COOKIE", "")


def api_post(path, data, retries=2):
    """Post JSON to the portal API with retry."""
    for attempt in range(retries + 1):
        try:
            req = urllib.request.Request(
                f"{API_BASE}{path}",
                data=json.dumps(data).encode(),
                headers={"Content-Type": "application/json", "Cookie": f"olam_session={AUTH_COOKIE}"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=15) as resp:
                body = resp.read()
                try:
                    return json.loads(body)
                except json.JSONDecodeError:
                    return {"ok": True}
        except Exception as e:
            if attempt < retries:
                time.sleep(2)
                continue
            print(f"  [api] {e}")
            return None


def search_estate(sb, court_id, last_name, first_name):
    """Search surrogate court for estate proceedings."""
    try:
        # If already on results page, click "New Search" instead of full reload
        current = sb.get_current_url()
        if "NameSearch" in current:
            try:
                new_search_btn = sb.find_elements("button.ButtonAsLink")
                for btn in new_search_btn:
                    if "Reset" in (btn.get_attribute("value") or ""):
                        btn.click()
                        sb.sleep(1)
                        break
                else:
                    sb.open("https://websurrogates.nycourts.gov/Names/NameSearch")
                    sb.sleep(1)
            except Exception:
                sb.open("https://websurrogates.nycourts.gov/Names/NameSearch")
                sb.sleep(1)
        else:
            sb.open("https://websurrogates.nycourts.gov/Names/NameSearch")
            sb.sleep(2)

        # Check if session expired or captcha popped up again
        current = sb.get_current_url()
        if "Authenticate" in current or "Welcome" in current or "NameSearch" not in current:
            print("\n  ****************************************************")
            print("  **  CAPTCHA REQUIRED — Solve it in the browser!   **")
            print("  ****************************************************")
            # Bring browser to front
            try:
                sb.driver.maximize_window()
            except Exception:
                pass
            # Navigate fresh
            sb.open("https://websurrogates.nycourts.gov/Names/NameSearch")
            sb.sleep(3)
            if "Welcome" in sb.get_current_url():
                try:
                    sb.click("button:contains('Start Search')")
                    sb.sleep(3)
                except Exception:
                    pass
            # Wait for user to solve captcha (up to 5 min)
            for wait in range(60):
                current = sb.get_current_url()
                if "Authenticate" not in current and "Welcome" not in current:
                    print("  ** CAPTCHA solved! Continuing... **")
                    sb.open("https://websurrogates.nycourts.gov/Names/NameSearch")
                    sb.sleep(2)
                    break
                time.sleep(5)
                if wait % 6 == 0:
                    print(f"  Waiting for CAPTCHA... ({wait * 5}s)")
            else:
                return {"found": False, "error": "Session expired — CAPTCHA timeout"}

        if not sb.is_element_present("#CourtSelect"):
            return {"found": False, "error": "Search page not available"}

        sb.select_option_by_value("#CourtSelect", court_id)
        sb.execute_script("document.getElementById('LastNameBox').value = " + json.dumps(last_name) + ";")
        sb.execute_script("document.getElementById('FirstNameBox').value = " + json.dumps(first_name) + ";")
        sb.click("#NameSearchSubmitName")
        sb.sleep(2)

        source = sb.get_page_source()
        if "No Matching Files Were Found" in source:
            return {"found": False}

        # Check if there are actual results
        if "Results 1" not in source and "File #" not in source:
            return {"found": False}

        # File numbers are inside <button> elements with class "ButtonAsLink"
        # e.g. <button name="button" class="ButtonAsLink" value="2017-103" type="submit">2017-103</button>
        file_numbers = []
        try:
            buttons = sb.find_elements("button.ButtonAsLink")
            for btn in buttons:
                try:
                    text = btn.text.strip()
                    # File numbers look like "2017-103" or "2017-103/A"
                    if text and "-" in text and len(text) < 20:
                        file_numbers.append(text)
                except Exception:
                    continue

            # Fallback: try table cells
            if not file_numbers:
                rows = sb.find_elements("#NameResultsTable tbody tr")
                for row in rows:
                    try:
                        cells = row.find_elements("css selector", "td")
                        if cells:
                            file_num = cells[0].text.strip()
                            if file_num and "-" in file_num:
                                file_numbers.append(file_num)
                    except Exception:
                        continue
        except Exception:
            pass

        # Deduplicate
        seen = set()
        unique = []
        for fn in file_numbers:
            if fn not in seen:
                seen.add(fn)
                unique.append(fn)

        return {"found": len(unique) > 0, "fileNumbers": unique}
    except Exception as e:
        return {"found": False, "error": str(e)}


def main():
    job_id = os.environ.get("ESTATE_JOB_ID", "")
    sheet_name = os.environ.get("ESTATE_SHEET_NAME", "")
    searches_file = os.environ.get("ESTATE_SEARCHES_FILE", "")

    # Parse searches from file or use standalone mode
    searches = []
    if searches_file and os.path.exists(searches_file):
        try:
            with open(searches_file, "r") as f:
                searches = json.load(f)
        except (json.JSONDecodeError, IOError) as e:
            print(f"Error reading searches file: {e}")
            searches = []
    else:
        # Standalone mode — read from Google Sheets directly
        try:
            from google.oauth2 import service_account
            from googleapiclient.discovery import build

            email = os.environ.get("GOOGLE_SERVICE_ACCOUNT_EMAIL", "")
            key = os.environ.get("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY", "")
            # Strip surrounding quotes and convert escaped newlines
            key = key.strip('"').strip("'").replace("\\n", "\n")
            sheet_id = os.environ.get("GOOGLE_SHEETS_SPREADSHEET_ID", "")
            sheet_name = sheet_name or os.environ.get("GOOGLE_SHEETS_SHEET_NAME", "Sheet1")

            creds = service_account.Credentials.from_service_account_info(
                {"client_email": email, "private_key": key, "token_uri": "https://oauth2.googleapis.com/token"},
                scopes=["https://www.googleapis.com/auth/spreadsheets"],
            )
            svc = build("sheets", "v4", credentials=creds)
            resp = svc.spreadsheets().values().get(
                spreadsheetId=sheet_id, range=f"{sheet_name}!A:M"
            ).execute()
            rows = resp.get("values", [])

            for i, row in enumerate(rows[1:], start=2):
                while len(row) < 13:
                    row.append("")
                if row[8] == "GOOD_LEAD" and not row[11]:
                    owner = row[4].strip()
                    if "," in owner:
                        # "LIRIANO, MARIA N" → last=LIRIANO, first=MARIA
                        parts = owner.split(",", 1)
                        last_name = parts[0].strip()
                        first_words = parts[1].strip().split() if len(parts) > 1 else []
                        first_name = first_words[0] if first_words else ""
                    else:
                        # No comma — filter out initials AND suffixes (JR, SR, etc.)
                        suffixes = {"JR", "SR", "II", "III", "IV", "ESQ"}
                        words = owner.split()
                        meaningful = [w for w in words if len(w) > 1 and w.upper() not in suffixes]
                        if len(meaningful) >= 2:
                            first_name = meaningful[0]
                            last_name = meaningful[-1]
                        elif len(meaningful) == 1:
                            last_name = meaningful[0]
                            first_name = ""
                        elif len(words) >= 2:
                            first_name = words[0]
                            last_name = words[-1]
                        else:
                            last_name = owner
                            first_name = ""
                    court = BOROUGH_TO_COURT.get(row[3].lower().strip(), "3")
                    searches.append({
                        "rowIndex": i,
                        "lastName": last_name,
                        "firstName": first_name,
                        "courtId": court,
                        "owner": row[4],
                        "borough": row[3],
                    })
        except Exception as e:
            print(f"Error reading sheet: {e}")

    if not searches:
        print("No GOOD_LEAD rows to check.")
        if not job_id:
            input("Press Enter to exit...")
        return

    print(f"\n{'='*60}")
    print(f"  Estate Scanner — {len(searches)} names to check")
    print(f"{'='*60}\n")

    # Notify portal of total
    if job_id:
        api_post(f"/api/estate/{job_id}", {"action": "update_total", "total": len(searches)})

    with SB(uc=True, test=True) as sb:
        sb.open("https://websurrogates.nycourts.gov/Names/NameSearch")
        sb.sleep(3)

        if "Welcome" in sb.get_current_url():
            print("Clicking Start Search...")
            sb.click("button:contains('Start Search')")
            sb.sleep(3)

        if "Authenticate" in sb.get_current_url():
            print()
            print("*" * 60)
            print("  SOLVE THE hCAPTCHA IN THE BROWSER WINDOW")
            print("*" * 60)
            print()

            for i in range(60):
                time.sleep(5)
                if "Authenticate" not in sb.get_current_url():
                    print("CAPTCHA solved!")
                    break
                if i % 6 == 0:
                    print(f"  Waiting... ({i * 5}s)")
            else:
                print("Timeout.")
                return

        # Notify portal captcha is solved
        if job_id:
            api_post(f"/api/estate/{job_id}", {"action": "captcha_solved"})

        sb.open("https://websurrogates.nycourts.gov/Names/NameSearch")
        sb.sleep(2)

        if not sb.is_element_present("#CourtSelect"):
            print("ERROR: Could not reach search page.")
            return

        # Also set up Google Sheets writer for standalone mode
        sheets_svc = None
        if not job_id:
            try:
                from google.oauth2 import service_account
                from googleapiclient.discovery import build

                email = os.environ.get("GOOGLE_SERVICE_ACCOUNT_EMAIL", "")
                key = os.environ.get("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY", "")
                key = key.strip('"').strip("'").replace("\\n", "\n")
                sheet_id = os.environ.get("GOOGLE_SHEETS_SPREADSHEET_ID", "")

                creds = service_account.Credentials.from_service_account_info(
                    {"client_email": email, "private_key": key, "token_uri": "https://oauth2.googleapis.com/token"},
                    scopes=["https://www.googleapis.com/auth/spreadsheets"],
                )
                sheets_svc = build("sheets", "v4", credentials=creds)
            except:
                pass

        def is_browser_alive(sb):
            """Check if browser window is still open."""
            try:
                sb.get_current_url()
                return True
            except Exception:
                return False

        found_count = 0
        cancelled = False
        for i, s in enumerate(searches):
            # Check if browser was closed
            if not is_browser_alive(sb):
                print("\n\nBrowser window closed — cancelling.")
                cancelled = True
                break

            # Skip rows with empty names
            if not s.get("lastName"):
                print(f"\n[{i+1}/{len(searches)}] SKIPPED — no name")
                continue

            name = f"{s['lastName']}, {s['firstName']}" if s.get("firstName") else s["lastName"]
            print(f"\n[{i+1}/{len(searches)}] {name} ({s['borough']})...", end=" ", flush=True)

            if job_id:
                api_post(f"/api/estate/{job_id}", {"action": "update_current", "name": name})

            try:
                result = search_estate(sb, s["courtId"], s["lastName"], s.get("firstName", ""))

                # If no results and name had no comma, try swapping first/last
                if not result.get("found") and s.get("firstName") and is_browser_alive(sb):
                    print("retrying swapped...", end=" ", flush=True)
                    result = search_estate(sb, s["courtId"], s["firstName"], s["lastName"])

                status = "YES" if result.get("found") else "NO"
                file_nums = "; ".join(result.get("fileNumbers", [])[:5])

                if result.get("found"):
                    print(f"ESTATE FOUND! {file_nums}")
                    found_count += 1
                else:
                    print("No estate.")

                # Write result
                if job_id:
                    api_post(f"/api/estate/{job_id}", {
                        "action": "result",
                        "rowIndex": s["rowIndex"],
                        "estateStatus": status,
                        "fileNumber": file_nums,
                        "sheetName": sheet_name,
                    })
                elif sheets_svc:
                    try:
                        sheet_id = os.environ.get("GOOGLE_SHEETS_SPREADSHEET_ID", "")
                        sn = sheet_name or os.environ.get("GOOGLE_SHEETS_SHEET_NAME", "Sheet1")
                        sheets_svc.spreadsheets().values().update(
                            spreadsheetId=sheet_id,
                            range=f"{sn}!L{s['rowIndex']}:M{s['rowIndex']}",
                            valueInputOption="RAW",
                            body={"values": [[status, file_nums]]},
                        ).execute()
                    except Exception as write_err:
                        print(f"  WARNING: Failed to write to sheet: {write_err}")

            except Exception as e:
                msg = str(e)
                # Browser closed mid-search
                if "no such window" in msg.lower() or "not reachable" in msg.lower() or "session" in msg.lower():
                    print("\n\nBrowser closed — cancelling.")
                    cancelled = True
                    break
                print(f"ERROR: {e}")
                if job_id:
                    api_post(f"/api/estate/{job_id}", {
                        "action": "result",
                        "rowIndex": s["rowIndex"],
                        "estateStatus": "ERROR",
                        "fileNumber": msg[:100],
                        "sheetName": sheet_name,
                    })

        # Complete
        if job_id:
            api_post(f"/api/estate/{job_id}", {"action": "complete"})

        print(f"\n{'='*60}")
        print(f"  COMPLETE — {found_count} estates found out of {len(searches)}")
        print(f"{'='*60}")

    if not job_id:
        input("\nPress Enter to exit...")


if __name__ == "__main__":
    main()

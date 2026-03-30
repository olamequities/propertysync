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


def api_post(path, data):
    """Post JSON to the portal API."""
    try:
        req = urllib.request.Request(
            f"{API_BASE}{path}",
            data=json.dumps(data).encode(),
            headers={"Content-Type": "application/json", "Cookie": f"olam_session={AUTH_COOKIE}"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read())
    except Exception as e:
        print(f"  [api] {e}")
        return None


def search_estate(sb, court_id, last_name, first_name):
    """Search surrogate court for estate proceedings."""
    try:
        sb.open("https://websurrogates.nycourts.gov/Names/NameSearch")
        sb.sleep(2)

        if not sb.is_element_present("#CourtSelect"):
            return {"found": False, "error": "Search page not available"}

        sb.select_option_by_value("#CourtSelect", court_id)
        sb.clear("#LastNameBox")
        sb.type("#LastNameBox", last_name)
        sb.clear("#FirstNameBox")
        if first_name:
            sb.type("#FirstNameBox", first_name)
        sb.click("#NameSearchSubmitName")
        sb.sleep(3)

        source = sb.get_page_source()
        if "No Matching Files Were Found" in source:
            return {"found": False}

        # Extract file numbers
        file_numbers = []
        try:
            rows = sb.find_elements("table tr")
            for row in rows[1:]:
                try:
                    cells = row.find_elements("css selector", "td")
                    if cells and len(cells) > 0:
                        file_num = cells[0].text.strip() if cells[0].text else ""
                        if file_num:
                            file_numbers.append(file_num)
                except Exception:
                    continue
        except Exception:
            pass

        # Deduplicate file numbers
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
        with open(searches_file, "r") as f:
            searches = json.load(f)
    else:
        # Standalone mode — read from Google Sheets directly
        try:
            from google.oauth2 import service_account
            from googleapiclient.discovery import build

            email = os.environ.get("GOOGLE_SERVICE_ACCOUNT_EMAIL", "")
            key = os.environ.get("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY", "").replace("\\n", "\n")
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
                    parts = row[4].split(",", 1)
                    last_name = parts[0].strip()
                    first_name = parts[1].strip() if len(parts) > 1 else ""
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
                key = os.environ.get("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY", "").replace("\\n", "\n")
                sheet_id = os.environ.get("GOOGLE_SHEETS_SPREADSHEET_ID", "")

                creds = service_account.Credentials.from_service_account_info(
                    {"client_email": email, "private_key": key, "token_uri": "https://oauth2.googleapis.com/token"},
                    scopes=["https://www.googleapis.com/auth/spreadsheets"],
                )
                sheets_svc = build("sheets", "v4", credentials=creds)
            except:
                pass

        found_count = 0
        for i, s in enumerate(searches):
            name = f"{s['lastName']}, {s['firstName']}" if s.get("firstName") else s["lastName"]
            print(f"\n[{i+1}/{len(searches)}] {name} ({s['borough']})...", end=" ", flush=True)

            if job_id:
                api_post(f"/api/estate/{job_id}", {"action": "update_current", "name": name})

            try:
                result = search_estate(sb, s["courtId"], s["lastName"], s.get("firstName", ""))
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
                    sheet_id = os.environ.get("GOOGLE_SHEETS_SPREADSHEET_ID", "")
                    sn = sheet_name or os.environ.get("GOOGLE_SHEETS_SHEET_NAME", "Sheet1")
                    sheets_svc.spreadsheets().values().update(
                        spreadsheetId=sheet_id,
                        range=f"{sn}!L{s['rowIndex']}:M{s['rowIndex']}",
                        valueInputOption="RAW",
                        body={"values": [[status, file_nums]]},
                    ).execute()

            except Exception as e:
                print(f"ERROR: {e}")
                if job_id:
                    api_post(f"/api/estate/{job_id}", {
                        "action": "result",
                        "rowIndex": s["rowIndex"],
                        "estateStatus": "ERROR",
                        "fileNumber": str(e)[:100],
                        "sheetName": sheet_name,
                    })

            time.sleep(1)

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

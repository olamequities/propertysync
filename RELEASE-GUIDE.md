# PropScope — Release Guide

## Overview

PropScope has two deployments:
- **Railway** — web version at your Railway URL (no estate scanner)
- **Desktop App** — Electron app with auto-updates via GitHub Releases (includes estate scanner)

---

## Railway (Web Version)

Deploys automatically when you push to `main`.

```bash
git add -A
git commit -m "your changes"
git push
```

Railway picks it up and redeploys. Done.

---

## Desktop App (Electron)

### First-Time Setup

1. **Create a GitHub repo** (if not already):
   ```bash
   gh repo create lchira99/olam-app --private --source=. --push
   ```

2. **That's it.** The `GITHUB_TOKEN` is automatically provided by GitHub Actions.

### Releasing an Update

1. **Bump the version** in `package.json`:
   ```json
   "version": "1.2.0"
   ```

2. **Commit and tag**:
   ```bash
   git add -A
   git commit -m "v1.2.0 - description of changes"
   git tag v1.2.0
   git push && git push --tags
   ```

3. **GitHub Actions builds automatically**:
   - Windows `.exe` installer builds on `windows-latest`
   - Mac `.dmg` installer builds on `macos-latest`
   - Both are uploaded to GitHub Releases

4. **Client gets the update**:
   - On next app launch, it checks for updates
   - Shows a dialog: "Version 1.2.0 has been downloaded. Restart now?"
   - They click "Restart" and they're on the new version

### Version Numbering

Use semantic versioning:
- `1.1.0` → `1.1.1` for bug fixes
- `1.1.0` → `1.2.0` for new features
- `1.2.0` → `2.0.0` for breaking changes

### Building Locally (Optional)

If you want to build the installer on your machine instead of GitHub Actions:

**Windows** (from Windows CMD, not WSL):
```bash
cd D:\Robots\Clients\flow\olam\olam-app
npm run electron:build:win
```

**Mac** (from a Mac terminal):
```bash
npm run electron:build:mac
```

Installers output to `dist-electron/`.

---

## Client Installation

### First Install

1. Go to the GitHub Releases page
2. Download:
   - Windows: `PropScope Setup 1.1.0.exe`
   - Mac: `PropScope-1.1.0.dmg`
3. Install like any normal app
4. On first launch, PropScope asks for its configuration file — select the `.env` you sent them

### The `.env` File

The installers are public, so **credentials are never bundled** — send the client this file privately (not by email in plain text if you can avoid it):

```
AUTH_USERNAME=their_username
AUTH_PASSWORD=their_password
JWT_SECRET=some_random_secret
GOOGLE_SERVICE_ACCOUNT_EMAIL=service-account@project.iam.gserviceaccount.com
GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
GOOGLE_SHEETS_SPREADSHEET_ID=their_sheet_id
GOOGLE_SHEETS_SHEET_NAME=Sheet1
```

The app copies it to `%APPDATA%\PropScope\.env` (Mac: `~/Library/Application Support/olam-app/.env`), which survives updates.

**Updating credentials** (e.g. after rotating the key): put the new `.env` next to `PropScope.exe` in the install folder and restart the app — a newer file there is imported automatically. Or delete the `.env` in the app data folder and the app will ask for the file again.

### Requirements for Estate Scanner

The client needs **Python** installed for the estate scanner to work:
- Windows: Install from Microsoft Store (search "Python")
- Mac: `brew install python3`

Also install the Python dependencies once:
```bash
pip install seleniumbase google-api-python-client google-auth
```

---

## Sheet Columns

| Col | Header | Filled By |
|-----|--------|-----------|
| A | Full Address | Manual |
| B | House Number | Manual |
| C | Street | Manual |
| D | Borough | Manual |
| E | Owner Name | Sync |
| F | Billing Name | Sync |
| G | Block | Sync |
| H | Lot | Sync |
| I | Parcel Status | Parcel Scan |
| J | Parcel Details | Parcel Scan |
| K | Processed | Sync |
| L | Estate Status | Estate Scanner |
| M | Estate File Number | Estate Scanner |

---

## How Each Feature Works

### Property Sync (Start Sync button)
- Scrapes NYC property site for owner/billing info
- Writes to columns E, F, G, H, K
- Runs from server (Railway or Electron)

### Parcel Scan (Identify Parcels button)
- Queries NYC Open Data API for ACRIS documents
- Analyzes for reverse mortgages
- Writes to columns I, J
- Runs from server (Railway or Electron)

### Estate Scanner (Check Estates button)
- Searches NYC Surrogate Court for estate proceedings
- Requires solving hCaptcha once (user clicks in browser)
- Writes to columns L, M
- Runs via Python/SeleniumBase (desktop app only)

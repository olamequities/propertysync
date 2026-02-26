# Olam PropertySync

NYC property owner and billing information lookup tool for Olam Equities. Syncs data from the NYC property database into Google Sheets.

## How It Works

1. Addresses are added to a Google Sheet (columns A–D)
2. Click **Start sync** to scrape the NYC property database for each address
3. Owner name and billing info are written back to the sheet (columns E–F) in real-time
4. Progress is streamed live via Server-Sent Events

## Tech Stack

- **Framework**: Next.js 15 (App Router)
- **Language**: TypeScript 5.7
- **Styling**: Tailwind CSS 4.0
- **Auth**: JWT with httpOnly cookies
- **Data**: Google Sheets API (googleapis)
- **Scraping**: Cheerio (NYC property database)
- **Deployment**: Docker / Railway

## Sheet Structure

| Column | Header | Filled By |
|--------|--------|-----------|
| A | Full Address | User |
| B | House Number | User |
| C | Street | User |
| D | Borough | User |
| E | Owner Name | App |
| F | Billing Name and Address | App |

Borough values can be text (`Brooklyn`, `Manhattan`, etc.) or numeric codes (`1`–`5`).

## Setup

1. Copy the example env file:
   ```bash
   cp .env.example .env.local
   ```

2. Fill in the values in `.env.local` (see below)

3. Share your Google Sheet with the service account email as **Editor**

4. Install dependencies and run:
   ```bash
   npm install
   npm run dev
   ```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `AUTH_USERNAME` | Login username |
| `AUTH_PASSWORD` | Login password |
| `JWT_SECRET` | Random 32+ char string for session tokens |
| `GOOGLE_SHEETS_SPREADSHEET_ID` | ID from the Google Sheet URL |
| `GOOGLE_SHEETS_SHEET_NAME` | Default tab name (fallback) |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | Google service account email |
| `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` | Service account private key |
| `SCRAPER_BOROUGH` | Default borough code (1–5) |
| `SCRAPER_DELAY_MS` | Delay between scrapes in ms |
| `SCRAPER_ASSESSMENT_MODE` | NYC assessment mode |
| `ZAPIER_WEBHOOK_URL` | Optional webhook on sync completion |

## Google Service Account

1. Go to [Google Cloud Console](https://console.cloud.google.com) → IAM & Admin → Service Accounts
2. Create a service account → Keys → Add Key → JSON
3. Use `client_email` and `private_key` from the downloaded JSON
4. Share the Google Sheet with the service account email (Editor access)

## Deployment (Railway)

1. Connect your repo to Railway
2. Railway auto-detects the Dockerfile
3. Add all env vars in Settings → Variables
4. Deploy — runs on port 3000

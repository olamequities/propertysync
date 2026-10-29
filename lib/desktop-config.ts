import fs from "fs";

// Desktop app only. The installer ships no credentials: on login, the local
// server checks the username/password against the Railway server, which
// returns the shared settings (Google service account, sheet ID, …). They are
// cached in the per-user config file so the app still works offline.

// Settings the Railway server hands to the desktop app
export const SHARED_CONFIG_KEYS = [
  "GOOGLE_SERVICE_ACCOUNT_EMAIL",
  "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY",
  "GOOGLE_SHEETS_SPREADSHEET_ID",
  "GOOGLE_SHEETS_SHEET_NAME",
  "SCRAPER_BOROUGH",
  "SCRAPER_DELAY_MS",
  "SCRAPER_ASSESSMENT_MODE",
  "ACRIS_DELAY_MS",
  "PARCEL_DELAY_MS",
  "NYC_OPENDATA_APP_TOKEN",
  "ZAPIER_WEBHOOK_URL",
] as const;

export function isDesktopRemoteConfig(): boolean {
  return !!process.env.DESKTOP_REMOTE_CONFIG_URL;
}

/**
 * Fetch shared settings from the Railway server with the user's login.
 * Returns true on success, false if the login was rejected, null if the
 * server couldn't be reached (caller falls back to cached settings).
 */
export async function refreshDesktopConfig(username: string, password: string): Promise<boolean | null> {
  let res: Response;
  try {
    res = await fetch(`${process.env.DESKTOP_REMOTE_CONFIG_URL}/api/desktop-config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    console.error("[desktop-config] server unreachable:", (err as Error).message);
    return null;
  }
  if (res.status === 401) return false;
  if (!res.ok) {
    console.error("[desktop-config] server error:", res.status);
    return null;
  }

  const shared = (await res.json()) as Record<string, string>;
  const values: Record<string, string> = { AUTH_USERNAME: username, AUTH_PASSWORD: password };
  for (const key of SHARED_CONFIG_KEYS) {
    if (shared[key]) values[key] = shared[key];
  }
  Object.assign(process.env, values);
  saveConfig(values);
  return true;
}

// Merge values into the config file. Same parsing rules as electron/main.js;
// values are written double-quoted on one line with newlines as \n.
function saveConfig(values: Record<string, string>) {
  const file = process.env.DESKTOP_CONFIG_FILE;
  if (!file) return;
  const merged: Record<string, string> = {};
  if (fs.existsSync(file)) {
    const regex = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^\r\n]*)/gm;
    const content = fs.readFileSync(file, "utf-8");
    let m;
    while ((m = regex.exec(content)) !== null) {
      const raw = m[2];
      const quoted = raw.length > 1 && (raw[0] === '"' || raw[0] === "'") && raw.endsWith(raw[0]);
      merged[m[1]] = quoted ? raw.slice(1, -1) : raw.trim();
    }
  }
  for (const [key, val] of Object.entries(values)) merged[key] = val.replace(/\r?\n/g, "\\n");
  const out = Object.entries(merged).map(([k, v]) => `${k}="${v.replace(/\r?\n/g, "\\n")}"`);
  fs.writeFileSync(file, out.join("\n") + "\n", { mode: 0o600 });
}

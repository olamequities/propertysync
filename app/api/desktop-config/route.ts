import { NextRequest, NextResponse } from "next/server";
import { validateCredentials } from "@/lib/auth";
import { isDesktopRemoteConfig, SHARED_CONFIG_KEYS } from "@/lib/desktop-config";

// Served by the Railway server: hands the shared settings to a desktop app
// whose user logged in with the app's username/password.
let failures = 0;
let lockedUntil = 0;

export async function POST(request: NextRequest) {
  if (isDesktopRemoteConfig()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (Date.now() < lockedUntil) {
    return NextResponse.json({ error: "Too many attempts, try again later" }, { status: 429 });
  }

  const { username, password } = await request.json().catch(() => ({}));
  if (!validateCredentials(username, password)) {
    // Simple brute-force brake: 10 bad logins lock this endpoint for 5 minutes
    if (++failures >= 10) {
      failures = 0;
      lockedUntil = Date.now() + 5 * 60 * 1000;
    }
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }
  failures = 0;

  const config: Record<string, string> = {};
  for (const key of SHARED_CONFIG_KEYS) {
    const val = process.env[key];
    if (val) config[key] = val;
  }
  return NextResponse.json(config);
}

import { NextRequest, NextResponse } from "next/server";
import { validateCredentials, createSession, COOKIE_NAME } from "@/lib/auth";
import { isDesktopRemoteConfig, refreshDesktopConfig } from "@/lib/desktop-config";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { username, password } = body;

  // Desktop app: verify against the Railway server and pick up current settings;
  // if it can't be reached, fall back to the login cached from last time.
  const refreshed = isDesktopRemoteConfig() ? await refreshDesktopConfig(username, password) : null;
  if (refreshed === false || (refreshed === null && !validateCredentials(username, password))) {
    const offline = refreshed === null && isDesktopRemoteConfig() && !process.env.AUTH_USERNAME;
    return NextResponse.json(
      { error: offline ? "Can't reach the PropScope server — check your internet connection" : "Invalid credentials" },
      { status: offline ? 503 : 401 }
    );
  }

  const token = await createSession();
  const response = NextResponse.json({ ok: true });

  response.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24, // 24h
    path: "/",
  });

  return response;
}

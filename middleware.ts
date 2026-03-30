import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

const PROTECTED_PREFIXES = ["/api/sheet", "/api/sync", "/api/parcels", "/api/estate"];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Only protect specific API routes
  const isProtected = PROTECTED_PREFIXES.some((p) => pathname.startsWith(p));
  if (!isProtected) return NextResponse.next();

  // Allow estate progress updates from the local Python scanner (no auth needed)
  if (pathname.startsWith("/api/estate/") && request.method === "POST" && !pathname.endsWith("/launch")) {
    const host = request.headers.get("host") || "";
    if (host.startsWith("localhost") || host.startsWith("127.0.0.1")) {
      return NextResponse.next();
    }
  }

  const token = request.cookies.get("olam_session")?.value;
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const secret = new TextEncoder().encode(process.env.JWT_SECRET);
    await jwtVerify(token, secret);
    return NextResponse.next();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}

export const config = {
  matcher: ["/api/sheet/:path*", "/api/sync/:path*", "/api/parcels/:path*", "/api/estate/:path*"],
};

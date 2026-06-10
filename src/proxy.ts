import { NextResponse, type NextRequest } from "next/server";

// Per-browser-session identity for the feedback feature. Set once via
// crypto.randomUUID(), lives for 2 years, scoped to chat-rendering routes
// only via the matcher below. No PII is captured — just an opaque UUID
// stored in an httpOnly cookie so the feedback API can correlate one
// browser session's votes across page loads without auth.
const FEEDBACK_SESSION_COOKIE = "feedback_session";
const TWO_YEARS_SECONDS = 60 * 60 * 24 * 365 * 2; // 63,072,000

export function proxy(request: NextRequest) {
  const response = NextResponse.next();

  if (!request.cookies.get(FEEDBACK_SESSION_COOKIE)) {
    response.cookies.set({
      name: FEEDBACK_SESSION_COOKIE,
      value: crypto.randomUUID(),
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: TWO_YEARS_SECONDS,
      path: "/",
    });
  }

  return response;
}

// Narrow allowlist — explicit routes that render chat OR call the feedback API.
// Adding a route here is opt-in; nothing else (static assets, other APIs,
// /privacy, /terms, /upgrade, /admin, etc.) ever invokes this proxy.
export const config = {
  matcher: ["/", "/api/feedback", "/api/feedback/:path*"],
};

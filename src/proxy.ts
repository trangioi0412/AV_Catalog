import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { hasValidCronSecret } from "@/lib/auth/cron";
import { hasRole } from "@/lib/auth/guard";
import { getRequestUser, portalSsoUrl } from "@/lib/auth/session";

/**
 * Whole-site guard: every page, API route and /public file needs a valid
 * `catalog_session` (issued by /api/auth/callback after Portal SSO) with at
 * least the viewer role. Excluded by the matcher: /api/auth/* (the SSO
 * callback itself) and Next's build assets.
 *
 * This is the first gate only — route handlers and server actions check
 * auth and role again themselves (src/lib/auth/guard.ts).
 *
 * /api/cron/* is the one machine-to-machine exception: it passes with
 * `Authorization: Bearer <CRON_SECRET>` (the route checks it again).
 */
export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const isApi = pathname === "/api" || pathname.startsWith("/api/");

  if (pathname.startsWith("/api/cron/") && hasValidCronSecret(request)) {
    return NextResponse.next();
  }

  if (hasRole(await getRequestUser(request), "viewer")) {
    // Old /login bookmarks: already signed in, go straight to the app (done here
    // rather than in the page so it is a real 307, not a streamed client redirect).
    if (pathname === "/login") return NextResponse.redirect(new URL("/admin/dashboard", request.url));
    return NextResponse.next();
  }

  if (isApi) {
    return NextResponse.json(
      { error: "Unauthorized: đăng nhập qua AVS Portal để dùng API này." },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    );
  }

  try {
    return NextResponse.redirect(portalSsoUrl(pathname + search));
  } catch (err) {
    // PORTAL_URL missing or malformed: deny with a clear status instead of an
    // unhandled 500. Never fall through to the page.
    console.error("[proxy] Portal SSO is not configured:", (err as Error).message);
    return new NextResponse("Đăng nhập chưa được cấu hình (PORTAL_URL). Liên hệ quản trị viên.", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
}

export const config = {
  matcher: [
    /*
     * Everything except /api/auth/* and Next's build assets. /public files are
     * guarded too: the old "skip by file extension" rule also skipped API
     * routes and pages whose dynamic segment ended in .png/.txt/…, and nothing
     * in /public has to be readable before sign-in.
     */
    "/((?!api/auth/|_next/static|_next/image|favicon\\.ico$).*)",
  ],
};

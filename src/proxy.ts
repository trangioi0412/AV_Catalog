import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { hasValidCronSecret } from "@/lib/auth/cron";
import { hasRole } from "@/lib/auth/guard";
import { getRequestUser, portalSsoUrl } from "@/lib/auth/session";

/**
 * Whole-site guard: every page, API route and /public file needs a valid
 * `catalog_session` (issued by /api/auth/callback after Portal SSO) with at
 * least the viewer role. Excluded by the matcher: /api/auth/* (the SSO
 * callback itself), Next's build assets, and the public catalog that
 * customers, search engines and the Wix site open without signing in:
 * /products/* pages and the /product_image/ and /downloads/ files.
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
    // Relative Location: `request.url` may say localhost on a LAN visit.
    if (pathname === "/login") return new NextResponse(null, { status: 307, headers: { Location: "/" } });
    return NextResponse.next();
  }

  // Server Action POSTs and RSC fetches can't follow a cross-origin redirect to
  // the portal (the fetch fails on CORS). Answer 401 instead: the action's
  // caller gets an error, and a client navigation falls back to a full page
  // load, which then gets the redirect below.
  const isFlightRequest = request.headers.has("next-action") || request.headers.has("rsc");

  if (isApi || isFlightRequest) {
    return NextResponse.json(
      { error: "Unauthorized: đăng nhập qua AVS Portal để dùng API này." },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    );
  }

  try {
    // Host: opened via a LAN address, the portal is reached on that address too.
    return NextResponse.redirect(portalSsoUrl(pathname + search, request.headers.get("host")));
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
     * Everything except /api/auth/*, Next's build assets and the public
     * catalog (see above). Other /public files are guarded too: the old "skip
     * by file extension" rule also skipped API routes and pages whose dynamic
     * segment ended in .png/.txt/….
     */
    "/((?!api/auth/|_next/static|_next/image|favicon\\.ico$|products/|product_image/|downloads/).*)",
  ],
};

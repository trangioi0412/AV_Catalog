/**
 * /api/auth/callback — end of the Portal SSO round trip.
 *
 * The portal POSTs a form { token, next } here. A valid token is swapped for
 * this site's own 8-hour `catalog_session` cookie; an invalid or expired one
 * gets a friendly 401 page with a "sign in again" button. Excluded from
 * src/proxy.ts.
 *
 * POST only: a GET handler would put the bearer token in the URL (access
 * logs, history, Referer) and let a plain link sign a victim in as someone
 * else. Next answers 405 for GET.
 *
 * Known gap: a cross-site auto-submitting form can still POST an attacker's
 * own fresh token (login CSRF). Closing it needs a `state` value the portal
 * echoes back, which is a portal protocol change.
 *
 * Never log the token: it is a bearer credential for its 60-second lifetime.
 */
import { NextResponse, type NextRequest } from "next/server";
import {
  SESSION_COOKIE,
  portalSsoUrl,
  safeNextPath,
  sessionCookieOptions,
  signSession,
  verifySsoToken,
} from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  let token: string | null = null;
  let next: string | null = null;
  try {
    const form = await request.formData();
    const t = form.get("token");
    const n = form.get("next");
    token = typeof t === "string" ? t : null;
    next = typeof n === "string" ? n : null;
  } catch {
    // Not a form body — falls through to the 401 page.
  }
  return handleCallback(request, token, next);
}

async function handleCallback(request: NextRequest, token: string | null, rawNext: string | null) {
  const next = safeNextPath(rawNext);
  const user = await verifySsoToken(token);
  if (!user) return errorPage(next);

  // 303 so the browser follows the POST with a GET.
  const response = NextResponse.redirect(new URL(next, request.url), 303);
  response.cookies.set(SESSION_COOKIE, await signSession(user), sessionCookieOptions);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function errorPage(next: string) {
  let loginUrl: string;
  try {
    loginUrl = escapeHtml(portalSsoUrl(next));
  } catch {
    loginUrl = "/"; // PORTAL_URL not configured; still answer 401, not 500
  }
  const html = `<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Phiên đăng nhập không hợp lệ | AVS-TEK Catalog</title>
<style>body{font-family:system-ui,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;background:#f7f8fa;color:#343434;padding:16px}
.box{max-width:420px;text-align:center;background:#fff;border-radius:12px;padding:32px 24px;box-shadow:0 4px 24px rgba(0,0,0,.06)}
h1{font-size:20px;margin:0 0 8px}p{margin:0 0 20px;line-height:1.5;color:#5b5b5b}
a{display:inline-block;background:#0057F9;color:#fff;text-decoration:none;border-radius:8px;padding:10px 18px;font-weight:600}</style>
</head><body><div class="box">
<h1>Không thể đăng nhập</h1>
<p>Liên kết đăng nhập từ AVS Portal không hợp lệ hoặc đã hết hạn (hiệu lực 60 giây). Vui lòng đăng nhập lại.</p>
<a href="${loginUrl}">Đăng nhập lại</a>
</div></body></html>`;

  return new NextResponse(html, {
    status: 401,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Frame-Options": "DENY",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
    },
  });
}

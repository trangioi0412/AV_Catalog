"use server";

/**
 * TODO(remove-password-login): legacy email/password login, disabled since
 * Portal SSO (src/lib/auth/session.ts). Delete loginAction, login/legacy-password-login.tsx
 * and the ADMIN_EMAIL / ADMIN_PASSWORD env vars once SSO is stable on production.
 * The hard-coded fallback credentials that used to live here were removed on purpose.
 */

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, isAuthEnabled, portalUrl } from "@/lib/auth/session";

type LoginState = { success: boolean; error?: string } | null;

export async function loginAction(): Promise<LoginState> {
  return { success: false, error: "Đăng nhập bằng mật khẩu đã tắt. Vui lòng đăng nhập qua AVS Portal." };
}

/**
 * Clears this site's session, then ends the portal session too
 * (${PORTAL_URL}/logout) so the next visit asks to sign in again.
 *
 * A Server Action rather than a GET route: Next rejects Server Action POSTs
 * whose Origin does not match the host, so a third-party page cannot sign
 * users out. The session JWT itself stays valid until it expires (8h) if it
 * was copied before logout — there is no server-side revocation list.
 */
export async function logoutAction() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  // TODO(remove-password-login): drop once the legacy admin_session cookie is gone.
  store.delete("admin_session");

  let target = "/";
  if (isAuthEnabled()) {
    try {
      target = `${portalUrl()}/logout`;
    } catch {
      // PORTAL_URL not configured: the local cookie is gone, go home.
    }
  }
  redirect(target);
}

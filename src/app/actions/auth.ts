"use server";

/** Sign-in happens on AVS Portal (SSO, src/lib/auth/session.ts); only logout lives here. */

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, isAuthEnabled, portalPublicUrl } from "@/lib/auth/session";

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
      // Signed in through a LAN address: log out of the portal on that address.
      target = `${portalPublicUrl((await headers()).get("host"))}/logout`;
    } catch {
      // PORTAL_URL not configured: the local cookie is gone, go home.
    }
  }
  redirect(target);
}

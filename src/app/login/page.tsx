/**
 * /login — kept as an entry point for old bookmarks. Password sign-in is
 * disabled; sign-in happens on AVS Portal (SSO). src/proxy.ts already sends
 * visitors without a session to the portal, so this only runs with a session.
 */
import { redirect } from "next/navigation";
import { getCatalogUser, portalSsoUrl } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const user = await getCatalogUser();
  redirect(user ? "/admin/dashboard" : portalSsoUrl("/admin/dashboard"));
}

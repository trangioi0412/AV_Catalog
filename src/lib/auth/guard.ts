/**
 * Authorization for every server-side entry point (route handlers, server
 * actions, server components). src/proxy.ts is only the first gate: each
 * entry point must check again, because a matcher change or a moved Server
 * Function silently drops proxy coverage.
 *
 * Roles come from the portal's `siteRole` claim for av-catalog
 * (AVS_Portal SITE_ROLES): viewer < editor < admin. `superAdmin` passes
 * every check. Any other role value grants nothing.
 *
 *   viewer — read only
 *   editor — content writes (CMS, translations, uploads, approve queue)
 *   admin  — destructive or configuration operations
 */
import { NextResponse, type NextRequest } from "next/server";
import { getCatalogUser, getRequestUser, type CatalogUser } from "./session";

export type SiteRole = "viewer" | "editor" | "admin";

const ROLE_RANK: Record<SiteRole, number> = { viewer: 1, editor: 2, admin: 3 };

export function hasRole(user: CatalogUser | null, minRole: SiteRole): boolean {
  if (!user) return false;
  if (user.superAdmin) return true;
  const rank = Object.hasOwn(ROLE_RANK, user.role) ? ROLE_RANK[user.role as SiteRole] : 0;
  return rank >= ROLE_RANK[minRole];
}

export class AuthError extends Error {
  constructor(readonly status: 401 | 403) {
    super(status === 401 ? "Unauthorized: vui lòng đăng nhập qua AVS Portal." : "Forbidden: tài khoản không đủ quyền.");
    this.name = "AuthError";
  }
}

/** Server actions and server components: returns the user or throws AuthError. */
export async function requireUser(minRole: SiteRole): Promise<CatalogUser> {
  const user = await getCatalogUser();
  if (!user) throw new AuthError(401);
  if (!hasRole(user, minRole)) throw new AuthError(403);
  return user;
}

/**
 * Route handlers: `const denied = await authorizeRequest(req, "editor"); if (denied) return denied;`
 * Returns a 401/403 JSON response when access is denied, null when allowed.
 */
export async function authorizeRequest(req: NextRequest, minRole: SiteRole): Promise<NextResponse | null> {
  const user = await getRequestUser(req);
  if (hasRole(user, minRole)) return null;
  const err = new AuthError(user ? 403 : 401);
  return NextResponse.json({ error: err.message }, { status: err.status, headers: { "Cache-Control": "no-store" } });
}

/** Boolean form used by the older admin routes (they answer 401 themselves). */
export async function checkAdminSession(req: NextRequest, minRole: SiteRole): Promise<boolean> {
  return hasRole(await getRequestUser(req), minRole);
}

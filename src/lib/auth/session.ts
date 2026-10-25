/**
 * SSO with AVS_Portal.
 *
 * 1. A visitor without a valid `catalog_session` cookie is sent to
 *    `${PORTAL_URL}/sso/av-catalog?next=<path>` (see src/proxy.ts).
 * 2. The portal checks the user may open this site, then POSTs a 60-second
 *    ES256 token (iss = PORTAL_URL, aud = "av-catalog") plus `next` to
 *    /api/auth/callback.
 * 3. The callback verifies that token with the portal's PUBLIC key and swaps it
 *    for this site's own 8-hour session cookie: an HS256 JWT signed with
 *    CATALOG_SESSION_SECRET (aud = "av-catalog-session"). The portal never
 *    knows that secret and this site never holds the portal's private key.
 *
 * Imported by src/proxy.ts as well as route handlers and server components,
 * so keep it free of `server-only` / React imports.
 */
import { SignJWT, importSPKI, jwtVerify, type JWTPayload } from "jose";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";

export const SESSION_COOKIE = "catalog_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 8;

const SSO_AUDIENCE = "av-catalog";
const SESSION_AUDIENCE = "av-catalog-session";
const SESSION_ISSUER = "av-catalog";

export interface CatalogUser {
  id: string;
  email: string;
  name: string;
  /** Site role the portal granted for av-catalog (its `siteRole` claim). */
  role: string;
  companyRole: string;
  superAdmin: boolean;
}

// ─── Config ──────────────────────────────────────────────────────────────────

/**
 * Fail-closed: Portal SSO is always on, except in local development
 * (`next dev`, NODE_ENV=development) with AUTH_ENABLED=false set explicitly.
 * Production builds — `next start`, Vercel Production and Preview — ignore
 * AUTH_ENABLED entirely, so a missing or misspelled flag can never open the
 * site. With SSO on, missing PORTAL_URL / PORTAL_SSO_PUBLIC_KEY /
 * CATALOG_SESSION_SECRET denies access instead of letting requests through.
 */
export function isAuthEnabled(): boolean {
  return !(process.env.NODE_ENV === "development" && process.env.AUTH_ENABLED === "false");
}

const DEV_USER: CatalogUser = {
  id: "dev",
  email: "",
  name: "Dev (đăng nhập đang tắt)",
  role: "admin",
  companyRole: "",
  superAdmin: false,
};

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

/** Portal base URL, no trailing slash. Must equal the portal's own PORTAL_URL (it is the token issuer). */
export function portalUrl(): string {
  return requiredEnv("PORTAL_URL").replace(/\/$/, "");
}

/** Where to send a visitor to sign in; the portal brings them back to `next`. */
export function portalSsoUrl(next: string): string {
  const url = new URL(`${portalUrl()}/sso/${SSO_AUDIENCE}`);
  url.searchParams.set("next", safeNextPath(next));
  return url.toString();
}

let sessionKey: Uint8Array | null = null;
function sessionSecret(): Uint8Array {
  if (!sessionKey) {
    const secret = requiredEnv("CATALOG_SESSION_SECRET");
    if (secret.length < 32) throw new Error("CATALOG_SESSION_SECRET must be at least 32 characters");
    sessionKey = new TextEncoder().encode(secret);
  }
  return sessionKey;
}

let portalKeyPromise: ReturnType<typeof importSPKI> | null = null;
function portalPublicKey() {
  // Env UIs often store a PEM on one line with literal "\n".
  portalKeyPromise ??= importSPKI(requiredEnv("PORTAL_SSO_PUBLIC_KEY").replace(/\\n/g, "\n"), "ES256");
  return portalKeyPromise;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Only same-site paths are allowed as a post-login target: must start with "/"
 * but not "//" or "/\" (browsers read both as protocol-relative URLs).
 */
export function safeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/";
  if (/[\u0000-\u001f\u007f]/.test(next)) return "/";
  return next;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function toUser(payload: JWTPayload, role: unknown): CatalogUser | null {
  if (typeof payload.sub !== "string" || !payload.sub) return null;
  return {
    id: payload.sub,
    email: str(payload.email),
    name: str(payload.name) || str(payload.email),
    role: str(role),
    companyRole: str(payload.companyRole),
    superAdmin: payload.superAdmin === true,
  };
}

// ─── Portal SSO token ────────────────────────────────────────────────────────

/** Verifies a portal SSO token (signature, alg, iss, aud, exp). Returns null when invalid. */
export async function verifySsoToken(token: string | null | undefined): Promise<CatalogUser | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, await portalPublicKey(), {
      algorithms: ["ES256"],
      issuer: portalUrl(),
      audience: SSO_AUDIENCE,
      requiredClaims: ["exp", "sub"],
      clockTolerance: 5,
    });
    return toUser(payload, payload.siteRole);
  } catch {
    return null;
  }
}

// ─── Catalog session cookie ──────────────────────────────────────────────────

export async function signSession(user: CatalogUser): Promise<string> {
  return new SignJWT({
    email: user.email,
    name: user.name,
    role: user.role,
    companyRole: user.companyRole,
    superAdmin: user.superAdmin,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(SESSION_ISSUER)
    .setAudience(SESSION_AUDIENCE)
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(sessionSecret());
}

export async function verifySession(token: string | null | undefined): Promise<CatalogUser | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, sessionSecret(), {
      algorithms: ["HS256"],
      issuer: SESSION_ISSUER,
      audience: SESSION_AUDIENCE,
      requiredClaims: ["exp", "sub"],
    });
    return toUser(payload, payload.role);
  } catch {
    return null;
  }
}

export const sessionCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/",
  maxAge: SESSION_TTL_SECONDS,
} as const;

/** Session user of an incoming request (proxy / route handlers). */
export async function getRequestUser(req: NextRequest): Promise<CatalogUser | null> {
  if (!isAuthEnabled()) return DEV_USER;
  return verifySession(req.cookies.get(SESSION_COOKIE)?.value);
}

/** Session user for server components, server actions and route handlers. */
export async function getCatalogUser(): Promise<CatalogUser | null> {
  if (!isAuthEnabled()) return DEV_USER;
  return verifySession((await cookies()).get(SESSION_COOKIE)?.value);
}

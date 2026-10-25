import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SignJWT } from "jose";
import { NextRequest } from "next/server";

const SECRET = "test-session-secret-that-is-long-enough-1234";

async function loadSession() {
  vi.resetModules(); // session.ts caches the decoded secret per module instance
  return import("./session");
}

function requestWithCookie(value?: string) {
  return new NextRequest("http://localhost/admin/dashboard", {
    headers: value ? { cookie: `catalog_session=${value}` } : {},
  });
}

const user = { id: "u1", email: "a@example.com", name: "A", role: "editor", companyRole: "", superAdmin: false };

describe("isAuthEnabled (fail-closed)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each([
    ["production", undefined, true],
    ["production", "false", true],
    ["test", "false", true],
    ["development", undefined, true],
    ["development", "true", true],
    ["development", "FALSE", true],
    ["development", "false", false],
  ])("NODE_ENV=%s AUTH_ENABLED=%s -> %s", async (nodeEnv, flag, expected) => {
    vi.stubEnv("NODE_ENV", nodeEnv);
    if (flag === undefined) delete process.env.AUTH_ENABLED;
    else vi.stubEnv("AUTH_ENABLED", flag);
    const { isAuthEnabled } = await loadSession();
    expect(isAuthEnabled()).toBe(expected);
  });
});

describe("session cookie", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CATALOG_SESSION_SECRET", SECRET);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("round-trips a signed session", async () => {
    const { signSession, getRequestUser } = await loadSession();
    const token = await signSession(user);
    expect(await getRequestUser(requestWithCookie(token))).toEqual(user);
  });

  it("denies a request without a cookie", async () => {
    const { getRequestUser } = await loadSession();
    expect(await getRequestUser(requestWithCookie())).toBeNull();
  });

  it("denies an expired session", async () => {
    const { getRequestUser } = await loadSession();
    const expired = await new SignJWT({ role: "admin" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer("av-catalog")
      .setAudience("av-catalog-session")
      .setSubject("u1")
      .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
      .sign(new TextEncoder().encode(SECRET));
    expect(await getRequestUser(requestWithCookie(expired))).toBeNull();
  });

  it("denies a session signed with another secret", async () => {
    const { getRequestUser } = await loadSession();
    const forged = await new SignJWT({ role: "admin" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer("av-catalog")
      .setAudience("av-catalog-session")
      .setSubject("u1")
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode("another-secret-that-is-also-long-enough-xx"));
    expect(await getRequestUser(requestWithCookie(forged))).toBeNull();
  });

  it("denies a garbage token", async () => {
    const { getRequestUser } = await loadSession();
    expect(await getRequestUser(requestWithCookie("not-a-jwt"))).toBeNull();
  });

  it("denies everything when CATALOG_SESSION_SECRET is missing", async () => {
    const { signSession } = await loadSession();
    const token = await signSession(user);
    delete process.env.CATALOG_SESSION_SECRET;
    const { getRequestUser } = await loadSession();
    expect(await getRequestUser(requestWithCookie(token))).toBeNull();
  });

  it("denies everything when CATALOG_SESSION_SECRET is too short", async () => {
    vi.stubEnv("CATALOG_SESSION_SECRET", "short");
    const { getRequestUser } = await loadSession();
    expect(await getRequestUser(requestWithCookie("x.y.z"))).toBeNull();
  });
});

describe("verifySsoToken", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("rejects any token when the portal key is not configured", async () => {
    vi.stubEnv("PORTAL_URL", "https://portal.example.com");
    delete process.env.PORTAL_SSO_PUBLIC_KEY;
    const { verifySsoToken } = await loadSession();
    expect(await verifySsoToken("a.b.c")).toBeNull();
    expect(await verifySsoToken(null)).toBeNull();
  });
});

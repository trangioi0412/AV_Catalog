import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/session")>();
  return { ...actual, verifySsoToken: vi.fn(), signSession: vi.fn(), portalSsoUrl: vi.fn() };
});

import { portalSsoUrl, signSession, verifySsoToken } from "@/lib/auth/session";
import * as route from "./route";

function post(fields: Record<string, string>) {
  return new NextRequest("http://localhost/api/auth/callback", { method: "POST", body: new URLSearchParams(fields) });
}

describe("/api/auth/callback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(portalSsoUrl).mockReturnValue("https://portal.example.com/sso/av-catalog?next=%2F");
    vi.mocked(signSession).mockResolvedValue("session-jwt");
  });

  it("has no GET handler (token must never travel in the URL)", () => {
    expect("GET" in route).toBe(false);
  });

  it("answers 401 for an invalid token", async () => {
    vi.mocked(verifySsoToken).mockResolvedValue(null);
    const res = await route.POST(post({ token: "bad", next: "/admin" }));
    expect(res.status).toBe(401);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("still answers 401, not 500, when PORTAL_URL is missing", async () => {
    vi.mocked(verifySsoToken).mockResolvedValue(null);
    vi.mocked(portalSsoUrl).mockImplementation(() => {
      throw new Error("PORTAL_URL is not set");
    });
    expect((await route.POST(post({ token: "bad" }))).status).toBe(401);
  });

  it("sets the session cookie and only redirects to same-site paths", async () => {
    vi.mocked(verifySsoToken).mockResolvedValue({ id: "u1", email: "", name: "", role: "viewer", companyRole: "", superAdmin: false });
    const res = await route.POST(post({ token: "good", next: "//evil.example.com/x" }));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("http://localhost/");
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("catalog_session=session-jwt");
    expect(cookie.toLowerCase()).toContain("httponly");
    expect(cookie.toLowerCase()).toContain("samesite=lax");
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth/session", () => ({ getRequestUser: vi.fn(), portalSsoUrl: vi.fn() }));

import { getRequestUser, portalSsoUrl, type CatalogUser } from "@/lib/auth/session";
import { config, proxy } from "./proxy";

const viewer: CatalogUser = { id: "u1", email: "", name: "", role: "viewer", companyRole: "", superAdmin: false };

function request(path: string, headers: Record<string, string> = {}) {
  return new NextRequest(`http://localhost${path}`, { headers });
}

describe("proxy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(portalSsoUrl).mockImplementation((next) => `https://portal.example.com/sso/av-catalog?next=${encodeURIComponent(next)}`);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("answers 401 JSON for an API call without a session", async () => {
    vi.mocked(getRequestUser).mockResolvedValue(null);
    const res = await proxy(request("/api/admin/wix-media"));
    expect(res.status).toBe(401);
  });

  it("redirects a page without a session to the portal", async () => {
    vi.mocked(getRequestUser).mockResolvedValue(null);
    const res = await proxy(request("/admin/dashboard?tab=1"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("next=%2Fadmin%2Fdashboard%3Ftab%3D1");
  });

  it("answers 503, not a 500 or the page, when PORTAL_URL is missing", async () => {
    vi.mocked(getRequestUser).mockResolvedValue(null);
    vi.mocked(portalSsoUrl).mockImplementation(() => {
      throw new Error("PORTAL_URL is not set");
    });
    const res = await proxy(request("/admin/dashboard"));
    expect(res.status).toBe(503);
    expect(res.headers.get("x-middleware-next")).toBeNull();
  });

  it("lets a viewer through", async () => {
    vi.mocked(getRequestUser).mockResolvedValue(viewer);
    const res = await proxy(request("/admin/dashboard"));
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("denies a session whose role grants nothing", async () => {
    vi.mocked(getRequestUser).mockResolvedValue({ ...viewer, role: "none" });
    expect((await proxy(request("/api/scan-status"))).status).toBe(401);
  });

  describe("cron", () => {
    beforeEach(() => vi.mocked(getRequestUser).mockResolvedValue(null));

    it("passes /api/cron/* with the Bearer secret", async () => {
      vi.stubEnv("CRON_SECRET", "cron-secret-value");
      const res = await proxy(request("/api/cron/discovery", { authorization: "Bearer cron-secret-value" }));
      expect(res.headers.get("x-middleware-next")).toBe("1");
    });

    it("no longer accepts the secret in the query string", async () => {
      vi.stubEnv("CRON_SECRET", "cron-secret-value");
      expect((await proxy(request("/api/cron/discovery?secret=cron-secret-value"))).status).toBe(401);
    });

    it("rejects a wrong secret", async () => {
      vi.stubEnv("CRON_SECRET", "cron-secret-value");
      expect((await proxy(request("/api/cron/discovery", { authorization: "Bearer wrong" }))).status).toBe(401);
    });

    it("rejects everything when CRON_SECRET is not set", async () => {
      delete process.env.CRON_SECRET;
      expect((await proxy(request("/api/cron/discovery", { authorization: "Bearer " }))).status).toBe(401);
    });

    it("does not let the cron secret open other routes", async () => {
      vi.stubEnv("CRON_SECRET", "cron-secret-value");
      expect((await proxy(request("/api/admin/wix-media", { authorization: "Bearer cron-secret-value" }))).status).toBe(401);
    });
  });
});

describe("proxy matcher", () => {
  const matcher = new RegExp(`^${config.matcher[0]}$`);

  it.each([
    "/",
    "/admin/dashboard",
    "/api/admin/wix-media",
    "/api/manufacturer-sync/sync/status/abc.png", // used to skip the proxy
    "/products/some-slug.png",
    "/product_image/QSYS/core-610.png",
    "/api/cron/discovery",
  ])("guards %s", (path) => {
    expect(matcher.test(path)).toBe(true);
  });

  it.each(["/api/auth/callback", "/api/auth/me", "/_next/static/chunks/a.js", "/_next/image", "/favicon.ico"])(
    "skips %s",
    (path) => {
      expect(matcher.test(path)).toBe(false);
    }
  );
});

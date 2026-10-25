import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("./session", () => ({ getCatalogUser: vi.fn(), getRequestUser: vi.fn() }));

import { getCatalogUser, getRequestUser, type CatalogUser } from "./session";
import { AuthError, authorizeRequest, checkAdminSession, hasRole, requireUser } from "./guard";

function userWith(role: string, superAdmin = false): CatalogUser {
  return { id: "u1", email: "a@example.com", name: "A", role, companyRole: "", superAdmin };
}

const req = new NextRequest("http://localhost/api/x");

describe("hasRole", () => {
  it.each([
    ["viewer", "viewer", true],
    ["viewer", "editor", false],
    ["viewer", "admin", false],
    ["editor", "viewer", true],
    ["editor", "editor", true],
    ["editor", "admin", false],
    ["admin", "admin", true],
  ] as const)("%s meets %s -> %s", (role, min, expected) => {
    expect(hasRole(userWith(role), min)).toBe(expected);
  });

  it("denies a missing user", () => {
    expect(hasRole(null, "viewer")).toBe(false);
  });

  it.each(["", "owner", "ADMIN", "constructor", "__proto__", "toString"])("grants nothing for unknown role %j", (role) => {
    expect(hasRole(userWith(role), "viewer")).toBe(false);
  });

  it("lets superAdmin through every check", () => {
    expect(hasRole(userWith("", true), "admin")).toBe(true);
  });
});

describe("requireUser (server actions)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("throws 401 without a session", async () => {
    vi.mocked(getCatalogUser).mockResolvedValue(null);
    await expect(requireUser("viewer")).rejects.toMatchObject({ name: "AuthError", status: 401 });
  });

  it("throws 403 when the role is too low", async () => {
    vi.mocked(getCatalogUser).mockResolvedValue(userWith("viewer"));
    const err = await requireUser("editor").catch((e) => e);
    expect(err).toBeInstanceOf(AuthError);
    expect(err.status).toBe(403);
  });

  it("returns the user when allowed", async () => {
    const u = userWith("admin");
    vi.mocked(getCatalogUser).mockResolvedValue(u);
    await expect(requireUser("admin")).resolves.toBe(u);
  });
});

describe("authorizeRequest (route handlers)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("answers 401 without a session", async () => {
    vi.mocked(getRequestUser).mockResolvedValue(null);
    const res = await authorizeRequest(req, "viewer");
    expect(res?.status).toBe(401);
    expect(res?.headers.get("Cache-Control")).toBe("no-store");
  });

  it("answers 403 when the role is too low", async () => {
    vi.mocked(getRequestUser).mockResolvedValue(userWith("editor"));
    expect((await authorizeRequest(req, "admin"))?.status).toBe(403);
  });

  it("returns null when allowed", async () => {
    vi.mocked(getRequestUser).mockResolvedValue(userWith("editor"));
    expect(await authorizeRequest(req, "editor")).toBeNull();
  });
});

describe("checkAdminSession", () => {
  it("requires the given role, not just a session", async () => {
    vi.mocked(getRequestUser).mockResolvedValue(userWith("viewer"));
    expect(await checkAdminSession(req, "viewer")).toBe(true);
    expect(await checkAdminSession(req, "editor")).toBe(false);
  });
});

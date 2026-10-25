import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth/session", () => ({ getRequestUser: vi.fn(), getCatalogUser: vi.fn() }));
vi.mock("@/lib/manufacturerSync/api", () => ({
  startSyncAll: vi.fn(),
  ManufacturerSyncApiError: class extends Error {},
}));

import { getRequestUser } from "@/lib/auth/session";
import { startSyncAll } from "@/lib/manufacturerSync/api";
import { POST } from "./route";

const req = () => new NextRequest("http://localhost/api/manufacturer-sync/sync/all", { method: "POST" });
const user = (role: string) => ({ id: "u1", email: "", name: "", role, companyRole: "", superAdmin: false });

describe("POST /api/manufacturer-sync/sync/all (admin only)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("answers 401 without a session and does not call the sync engine", async () => {
    vi.mocked(getRequestUser).mockResolvedValue(null);
    expect((await POST(req())).status).toBe(401);
    expect(startSyncAll).not.toHaveBeenCalled();
  });

  it("answers 403 for an editor", async () => {
    vi.mocked(getRequestUser).mockResolvedValue(user("editor"));
    expect((await POST(req())).status).toBe(403);
    expect(startSyncAll).not.toHaveBeenCalled();
  });

  it("runs for an admin", async () => {
    vi.mocked(getRequestUser).mockResolvedValue(user("admin"));
    vi.mocked(startSyncAll).mockResolvedValue({ success: true } as never);
    expect((await POST(req())).status).toBe(202);
    expect(startSyncAll).toHaveBeenCalledOnce();
  });
});

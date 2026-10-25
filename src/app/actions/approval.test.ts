import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getCatalogUser: vi.fn(), getRequestUser: vi.fn() }));
vi.mock("@/lib/services/wixCms", () => ({ insertProduct: vi.fn() }));
vi.mock("@/lib/services/googleSheets", () => ({
  readSheet: vi.fn(),
  deleteRowByIndex: vi.fn(),
  appendRows: vi.fn(),
  addLog: vi.fn(),
  updateSystemConfig: vi.fn(),
  getSystemConfig: vi.fn(),
  clearSheet: vi.fn(),
}));

import { getCatalogUser } from "@/lib/auth/session";
import { clearSheet, readSheet } from "@/lib/services/googleSheets";
import { approveProductAction, clearQueueAction } from "./approval";
import type { PendingProduct } from "./discovery";

const user = (role: string) => ({ id: "u1", email: "", name: "", role, companyRole: "", superAdmin: false });

describe("approval server actions enforce roles themselves", () => {
  beforeEach(() => vi.clearAllMocks());

  it("clearQueueAction rejects an unauthenticated caller before touching the sheet", async () => {
    vi.mocked(getCatalogUser).mockResolvedValue(null);
    await expect(clearQueueAction()).rejects.toMatchObject({ status: 401 });
    expect(clearSheet).not.toHaveBeenCalled();
  });

  it("clearQueueAction is admin-only", async () => {
    vi.mocked(getCatalogUser).mockResolvedValue(user("editor"));
    await expect(clearQueueAction()).rejects.toMatchObject({ status: 403 });
    expect(clearSheet).not.toHaveBeenCalled();
  });

  it("approveProductAction rejects a viewer before reading the queue", async () => {
    vi.mocked(getCatalogUser).mockResolvedValue(user("viewer"));
    await expect(approveProductAction({} as PendingProduct, 0)).rejects.toMatchObject({ status: 403 });
    expect(readSheet).not.toHaveBeenCalled();
  });
});

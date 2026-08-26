import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/services/wixCatalogPdf", () => ({ checkAdminSession: vi.fn() }));
vi.mock("@/services/wix-translation/translate-and-sync", () => ({
  translateAndSyncWixCmsItems: vi.fn(),
  TranslateAndSyncError: class extends Error {
    code: string;
    status: number;
    constructor(message: string, code = "VALIDATION_ERROR", status = 400) {
      super(message);
      this.code = code;
      this.status = status;
    }
  },
}));

import { checkAdminSession } from "@/lib/services/wixCatalogPdf";
import { translateAndSyncWixCmsItems } from "@/services/wix-translation/translate-and-sync";
import { POST } from "./route";

function makeRequest(body: unknown) {
  return new NextRequest("http://localhost/api/admin/wix-translations/save", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: "admin_session=true" },
    body: JSON.stringify(body),
  });
}

const VALID_BODY = {
  collectionKey: "products",
  sourceLocale: "vi",
  targetLocale: "en",
  fieldKeys: ["title"],
  mode: "draft",
  items: [{ itemId: "item-1", fieldValues: { title: "Neat Bar" }, sourceHash: "abc" }],
};

describe("POST /api/admin/wix-translations/save", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects unauthenticated requests without ever calling the translation service", async () => {
    vi.mocked(checkAdminSession).mockReturnValue(false);

    const res = await POST(makeRequest(VALID_BODY));

    expect(res.status).toBe(401);
    expect(translateAndSyncWixCmsItems).not.toHaveBeenCalled();
  });

  it("rejects a mode other than draft/publish", async () => {
    vi.mocked(checkAdminSession).mockReturnValue(true);

    const res = await POST(makeRequest({ ...VALID_BODY, mode: "preview" }));

    expect(res.status).toBe(400);
    expect(translateAndSyncWixCmsItems).not.toHaveBeenCalled();
  });

  it("rejects a batch larger than the max batch size", async () => {
    vi.mocked(checkAdminSession).mockReturnValue(true);
    const items = Array.from({ length: 21 }, (_, i) => ({ itemId: `item-${i}`, fieldValues: { title: "x" } }));

    const res = await POST(makeRequest({ ...VALID_BODY, items }));

    expect(res.status).toBe(400);
    expect(translateAndSyncWixCmsItems).not.toHaveBeenCalled();
  });

  it("passes mode through unchanged to the translation service (draft vs publish)", async () => {
    vi.mocked(checkAdminSession).mockReturnValue(true);
    vi.mocked(translateAndSyncWixCmsItems).mockResolvedValue({
      success: true, mode: "publish", sourceLocale: "vi", targetLocale: "en", total: 1, succeeded: 1, failed: 0, skipped: 0, items: [],
    });

    await POST(makeRequest({ ...VALID_BODY, mode: "publish" }));

    expect(translateAndSyncWixCmsItems).toHaveBeenCalledWith(expect.objectContaining({ mode: "publish" }));
  });

  it("never leaks internal error details in the response", async () => {
    vi.mocked(checkAdminSession).mockReturnValue(true);
    vi.mocked(translateAndSyncWixCmsItems).mockRejectedValue(new Error("secret WIX_API_KEY=abc123 in stack trace"));

    const res = await POST(makeRequest(VALID_BODY));
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(JSON.stringify(json)).not.toContain("WIX_API_KEY");
  });
});

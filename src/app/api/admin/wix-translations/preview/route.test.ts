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
  return new NextRequest("http://localhost/api/admin/wix-translations/preview", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: "admin_session=true" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/admin/wix-translations/preview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects unauthenticated requests without ever calling the translation service", async () => {
    vi.mocked(checkAdminSession).mockReturnValue(false);

    const res = await POST(makeRequest({ collectionKey: "products", itemIds: ["a"], sourceLocale: "vi", targetLocale: "en", fieldKeys: ["title"] }));

    expect(res.status).toBe(401);
    expect(translateAndSyncWixCmsItems).not.toHaveBeenCalled();
  });

  it("rejects a malformed body before calling the translation service", async () => {
    vi.mocked(checkAdminSession).mockReturnValue(true);

    const res = await POST(makeRequest({ collectionKey: "products" }));

    expect(res.status).toBe(400);
    expect(translateAndSyncWixCmsItems).not.toHaveBeenCalled();
  });

  it("always forces mode: 'preview' regardless of what else is in the body", async () => {
    vi.mocked(checkAdminSession).mockReturnValue(true);
    vi.mocked(translateAndSyncWixCmsItems).mockResolvedValue({
      success: true, mode: "preview", sourceLocale: "vi", targetLocale: "en", total: 1, succeeded: 1, failed: 0, skipped: 0, items: [],
    });

    await POST(
      makeRequest({
        collectionKey: "products",
        itemIds: ["a"],
        sourceLocale: "vi",
        targetLocale: "en",
        fieldKeys: ["title"],
        mode: "publish",
      })
    );

    expect(translateAndSyncWixCmsItems).toHaveBeenCalledWith(expect.objectContaining({ mode: "preview" }));
  });

  it("never leaks internal error details in the response", async () => {
    vi.mocked(checkAdminSession).mockReturnValue(true);
    vi.mocked(translateAndSyncWixCmsItems).mockRejectedValue(new Error("secret WIX_API_KEY=abc123 in stack trace"));

    const res = await POST(makeRequest({ collectionKey: "products", itemIds: ["a"], sourceLocale: "vi", targetLocale: "en", fieldKeys: ["title"] }));
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(JSON.stringify(json)).not.toContain("WIX_API_KEY");
  });
});

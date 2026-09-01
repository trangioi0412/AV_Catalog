import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/services/wixCatalogPdf", () => ({ checkAdminSession: vi.fn() }));
vi.mock("@/services/cms-translation/translate-cms.service", async () => {
  const actual = await vi.importActual<typeof import("@/services/cms-translation/translate-cms.service")>(
    "@/services/cms-translation/translate-cms.service"
  );
  return { ...actual, translateCmsEnglishToVietnamese: vi.fn() };
});

import { checkAdminSession } from "@/lib/services/wixCatalogPdf";
import { translateCmsEnglishToVietnamese } from "@/services/cms-translation/translate-cms.service";
import { POST } from "./route";

function makeRequest(body: unknown) {
  return new NextRequest("http://localhost/api/admin/cms-translate", {
    method: "POST",
    headers: { cookie: "admin_session=true", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const PREVIEW_BODY = {
  collectionKey: "products",
  mode: "preview",
  itemIds: ["item-1"],
  fieldMappings: [{ sourceField: "title_EN", targetField: "title_VI", type: "text" }],
};

const WRITE_BODY = {
  collectionKey: "products",
  mode: "write",
  items: [{ itemId: "item-1", fieldValues: { title_VI: "Bàn Neat (đã duyệt)" } }],
  fieldMappings: [{ sourceField: "title_EN", targetField: "title_VI", type: "text" }],
};

describe("POST /api/admin/cms-translate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects unauthenticated requests without calling the service", async () => {
    vi.mocked(checkAdminSession).mockReturnValue(false);
    const res = await POST(makeRequest(PREVIEW_BODY));
    expect(res.status).toBe(401);
    expect(translateCmsEnglishToVietnamese).not.toHaveBeenCalled();
  });

  it("rejects a request with no fieldMappings", async () => {
    vi.mocked(checkAdminSession).mockReturnValue(true);
    const res = await POST(makeRequest({ ...PREVIEW_BODY, fieldMappings: [] }));
    expect(res.status).toBe(400);
    expect(translateCmsEnglishToVietnamese).not.toHaveBeenCalled();
  });

  it("rejects a field mapping that targets a Wix system field", async () => {
    vi.mocked(checkAdminSession).mockReturnValue(true);
    const res = await POST(
      makeRequest({ ...PREVIEW_BODY, fieldMappings: [{ sourceField: "title_EN", targetField: "_id", type: "text" }] })
    );
    expect(res.status).toBe(400);
    expect(translateCmsEnglishToVietnamese).not.toHaveBeenCalled();
  });

  it("rejects a field mapping whose name isn't a plain identifier", async () => {
    vi.mocked(checkAdminSession).mockReturnValue(true);
    const res = await POST(
      makeRequest({ ...PREVIEW_BODY, fieldMappings: [{ sourceField: "title-EN!", targetField: "title_VI", type: "text" }] })
    );
    expect(res.status).toBe(400);
  });

  it('rejects mode "preview" with no itemIds', async () => {
    vi.mocked(checkAdminSession).mockReturnValue(true);
    const res = await POST(makeRequest({ ...PREVIEW_BODY, itemIds: undefined }));
    expect(res.status).toBe(400);
    expect(translateCmsEnglishToVietnamese).not.toHaveBeenCalled();
  });

  it("accepts an in-place field mapping (sourceField === targetField, for a field with no separate VI sibling)", async () => {
    vi.mocked(checkAdminSession).mockReturnValue(true);
    vi.mocked(translateCmsEnglishToVietnamese).mockResolvedValue({
      success: true,
      mode: "preview",
      summary: { total: 1, translated: 1, updated: 0, skipped: 0, failed: 0 },
      items: [{ itemId: "item-1", name: "Neat Bar", status: "translated", fieldValues: { mainFeature: { source: "AI noise cancellation", translated: "Khử tiếng ồn AI" } } }],
    });

    const res = await POST(
      makeRequest({ ...PREVIEW_BODY, overwrite: true, fieldMappings: [{ sourceField: "mainFeature", targetField: "mainFeature", type: "text" }] })
    );

    expect(res.status).toBe(200);
    expect(translateCmsEnglishToVietnamese).toHaveBeenCalled();
  });

  it('rejects mode "write" with no items', async () => {
    vi.mocked(checkAdminSession).mockReturnValue(true);
    const res = await POST(makeRequest({ ...WRITE_BODY, items: undefined }));
    expect(res.status).toBe(400);
    expect(translateCmsEnglishToVietnamese).not.toHaveBeenCalled();
  });

  it('passes a valid "preview" request through to the service and returns its result', async () => {
    vi.mocked(checkAdminSession).mockReturnValue(true);
    vi.mocked(translateCmsEnglishToVietnamese).mockResolvedValue({
      success: true,
      mode: "preview",
      summary: { total: 1, translated: 1, updated: 0, skipped: 0, failed: 0 },
      items: [{ itemId: "item-1", name: "Neat Bar", status: "translated", fieldValues: { title_VI: { source: "Neat Bar", translated: "Bàn Neat" } } }],
    });

    const res = await POST(makeRequest(PREVIEW_BODY));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.summary.translated).toBe(1);
    expect(vi.mocked(translateCmsEnglishToVietnamese).mock.calls[0][0]).toMatchObject({
      collectionKey: "products",
      mode: "preview",
      itemIds: ["item-1"],
    });
  });

  it('passes a valid "write" request through to the service, including the approved fieldValues', async () => {
    vi.mocked(checkAdminSession).mockReturnValue(true);
    vi.mocked(translateCmsEnglishToVietnamese).mockResolvedValue({
      success: true,
      mode: "write",
      summary: { total: 1, translated: 0, updated: 1, skipped: 0, failed: 0 },
      items: [{ itemId: "item-1", name: "Neat Bar", status: "updated", translatedFields: ["title_VI"] }],
    });

    const res = await POST(makeRequest(WRITE_BODY));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.summary.updated).toBe(1);
    expect(vi.mocked(translateCmsEnglishToVietnamese).mock.calls[0][0]).toMatchObject({
      mode: "write",
      items: [{ itemId: "item-1", fieldValues: { title_VI: "Bàn Neat (đã duyệt)" } }],
    });
  });

  it("never returns an API key, access token, or site secret", async () => {
    vi.mocked(checkAdminSession).mockReturnValue(true);
    vi.mocked(translateCmsEnglishToVietnamese).mockResolvedValue({
      success: true,
      mode: "preview",
      summary: { total: 0, translated: 0, updated: 0, skipped: 0, failed: 0 },
      items: [],
    });

    const res = await POST(makeRequest(PREVIEW_BODY));
    const text = JSON.stringify(await res.json());
    expect(text).not.toMatch(/WIX_API_KEY|apiKey|accessToken|siteSecret/i);
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/services/wixCatalogPdf", () => ({ checkAdminSession: vi.fn() }));
vi.mock("@/services/wix-translation/wix-cms.service", () => ({ getWixCmsItems: vi.fn() }));

import { checkAdminSession } from "@/lib/services/wixCatalogPdf";
import { getWixCmsItems } from "@/services/wix-translation/wix-cms.service";
import { GET } from "./route";

function makeRequest(query: string) {
  return new NextRequest(`http://localhost/api/admin/cms-translate/items${query}`, {
    headers: { cookie: "admin_session=true" },
  });
}

describe("GET /api/admin/cms-translate/items", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects unauthenticated requests", async () => {
    vi.mocked(checkAdminSession).mockReturnValue(false);
    const res = await GET(makeRequest("?collectionKey=products"));
    expect(res.status).toBe(401);
    expect(getWixCmsItems).not.toHaveBeenCalled();
  });

  it("rejects a collectionKey that isn't in the server allowlist", async () => {
    vi.mocked(checkAdminSession).mockReturnValue(true);
    const res = await GET(makeRequest("?collectionKey=not-allowed"));
    expect(res.status).toBe(422);
    expect(getWixCmsItems).not.toHaveBeenCalled();
  });

  it("marks translated:false for every item when no targetFields are given", async () => {
    vi.mocked(checkAdminSession).mockReturnValue(true);
    vi.mocked(getWixCmsItems).mockResolvedValue({
      items: [{ itemId: "a", data: { title_EN: "Neat Bar", title_VI: "Bàn Neat" } }],
      total: 1,
    });

    const res = await GET(makeRequest("?collectionKey=products"));
    const json = await res.json();

    expect(json.items[0].translated).toBe(false);
  });

  it("marks translated:true only when every target field has non-empty content", async () => {
    vi.mocked(checkAdminSession).mockReturnValue(true);
    vi.mocked(getWixCmsItems).mockResolvedValue({
      items: [
        { itemId: "full", data: { title_VI: "Đầy đủ", description_VI: "Có nội dung" } },
        { itemId: "partial", data: { title_VI: "Có rồi", description_VI: "" } },
        { itemId: "empty", data: {} },
      ],
      total: 3,
    });

    const res = await GET(makeRequest("?collectionKey=products&targetFields=title_VI,description_VI"));
    const json = await res.json();
    const byId = Object.fromEntries(json.items.map((i: { itemId: string; translated: boolean }) => [i.itemId, i.translated]));

    expect(byId.full).toBe(true);
    expect(byId.partial).toBe(false);
    expect(byId.empty).toBe(false);
  });

  it("lists exactly which target fields are still missing per item", async () => {
    vi.mocked(checkAdminSession).mockReturnValue(true);
    vi.mocked(getWixCmsItems).mockResolvedValue({
      items: [
        { itemId: "full", data: { title_VI: "Đầy đủ", description_VI: "Có nội dung" } },
        { itemId: "partial", data: { title_VI: "Có rồi", description_VI: "" } },
        { itemId: "empty", data: {} },
      ],
      total: 3,
    });

    const res = await GET(makeRequest("?collectionKey=products&targetFields=title_VI,description_VI"));
    const json = await res.json();
    const byId = Object.fromEntries(json.items.map((i: { itemId: string; untranslatedFields: string[] }) => [i.itemId, i.untranslatedFields]));

    expect(byId.full).toEqual([]);
    expect(byId.partial).toEqual(["description_VI"]);
    expect(byId.empty).toEqual(["title_VI", "description_VI"]);
  });

  it("resolves item name from title/name/product, falling back to itemId", async () => {
    vi.mocked(checkAdminSession).mockReturnValue(true);
    vi.mocked(getWixCmsItems).mockResolvedValue({
      items: [
        { itemId: "a", data: { title: "Has Title" } },
        { itemId: "b", data: {} },
      ],
      total: 2,
    });

    const res = await GET(makeRequest("?collectionKey=products"));
    const json = await res.json();

    expect(json.items[0].name).toBe("Has Title");
    expect(json.items[1].name).toBe("b");
  });

  it("never returns an API key, access token, or site secret", async () => {
    vi.mocked(checkAdminSession).mockReturnValue(true);
    vi.mocked(getWixCmsItems).mockResolvedValue({ items: [], total: 0 });
    const res = await GET(makeRequest("?collectionKey=products"));
    const text = JSON.stringify(await res.json());
    expect(text).not.toMatch(/WIX_API_KEY|apiKey|accessToken|siteSecret/i);
  });
});

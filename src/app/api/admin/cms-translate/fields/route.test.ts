import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/services/wixCatalogPdf", () => ({ checkAdminSession: vi.fn() }));
vi.mock("@/services/wix-translation/wix-cms.service", () => ({ getWixCollectionFields: vi.fn() }));

import { checkAdminSession } from "@/lib/services/wixCatalogPdf";
import { getWixCollectionFields } from "@/services/wix-translation/wix-cms.service";
import { GET } from "./route";

function makeRequest(query: string) {
  return new NextRequest(`http://localhost/api/admin/cms-translate/fields${query}`, {
    headers: { cookie: "admin_session=true" },
  });
}

describe("GET /api/admin/cms-translate/fields", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects unauthenticated requests", async () => {
    vi.mocked(checkAdminSession).mockReturnValue(false);
    const res = await GET(makeRequest("?collectionKey=products"));
    expect(res.status).toBe(401);
    expect(getWixCollectionFields).not.toHaveBeenCalled();
  });

  it("rejects a collectionKey that isn't in the server allowlist", async () => {
    vi.mocked(checkAdminSession).mockReturnValue(true);
    const res = await GET(makeRequest("?collectionKey=not-allowed"));
    expect(res.status).toBe(422);
    expect(getWixCollectionFields).not.toHaveBeenCalled();
  });

  it("hides Wix system fields from the picker", async () => {
    vi.mocked(checkAdminSession).mockReturnValue(true);
    vi.mocked(getWixCollectionFields).mockResolvedValue([
      { key: "_id", displayName: "_id", type: "TEXT" },
      { key: "title_EN", displayName: "Title (EN)", type: "TEXT" },
    ]);

    const res = await GET(makeRequest("?collectionKey=products"));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.fields).toEqual([{ key: "title_EN", displayName: "Title (EN)", type: "TEXT" }]);
  });

  it("never returns an API key, access token, or site secret", async () => {
    vi.mocked(checkAdminSession).mockReturnValue(true);
    vi.mocked(getWixCollectionFields).mockResolvedValue([]);
    const res = await GET(makeRequest("?collectionKey=products"));
    const text = JSON.stringify(await res.json());
    expect(text).not.toMatch(/WIX_API_KEY|apiKey|accessToken|siteSecret/i);
  });
});

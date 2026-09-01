import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/services/wixCatalogPdf", () => ({ checkAdminSession: vi.fn() }));
vi.mock("@/lib/wix/server-client", () => ({ isWixConfigured: vi.fn() }));
vi.mock("@/services/wix-translation/wix-cms.service", () => ({ getWixCollectionSchema: vi.fn() }));
vi.mock("@/services/wix-translation/wix-multilingual.service", () => ({
  getTranslatableFields: vi.fn(),
  listLocales: vi.fn(),
}));
vi.mock("@/services/wix-translation/translation-provider.service", () => ({
  getTranslationProviderName: vi.fn(() => "gemini"),
  isTranslationProviderConfigured: vi.fn(),
  listAvailableTranslationProviders: vi.fn(() => []),
  listOllamaModels: vi.fn(async () => []),
}));

import { checkAdminSession } from "@/lib/services/wixCatalogPdf";
import { isWixConfigured } from "@/lib/wix/server-client";
import { isTranslationProviderConfigured, listAvailableTranslationProviders } from "@/services/wix-translation/translation-provider.service";
import { GET } from "./route";

function makeRequest() {
  return new NextRequest("http://localhost/api/admin/wix-translations/config", {
    headers: { cookie: "admin_session=true" },
  });
}

describe("GET /api/admin/wix-translations/config", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects unauthenticated requests", async () => {
    vi.mocked(checkAdminSession).mockReturnValue(false);
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
  });

  it("degrades gracefully (still 200, with warnings) when Wix credentials are missing, instead of erroring", async () => {
    vi.mocked(checkAdminSession).mockReturnValue(true);
    vi.mocked(isWixConfigured).mockReturnValue(false);
    vi.mocked(isTranslationProviderConfigured).mockReturnValue(false);

    const res = await GET(makeRequest());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.wixConfigured).toBe(false);
    expect(json.warnings.length).toBeGreaterThan(0);
    expect(json.collections.length).toBeGreaterThan(0);
  });

  it("never returns an API key, access token, or site secret", async () => {
    vi.mocked(checkAdminSession).mockReturnValue(true);
    vi.mocked(isWixConfigured).mockReturnValue(false);
    vi.mocked(isTranslationProviderConfigured).mockReturnValue(false);

    const res = await GET(makeRequest());
    const text = JSON.stringify(await res.json());

    expect(text).not.toMatch(/WIX_API_KEY|apiKey|accessToken|siteSecret/i);
  });

  it("includes the list of selectable AI providers for the model picker", async () => {
    vi.mocked(checkAdminSession).mockReturnValue(true);
    vi.mocked(isWixConfigured).mockReturnValue(false);
    vi.mocked(isTranslationProviderConfigured).mockReturnValue(false);
    vi.mocked(listAvailableTranslationProviders).mockReturnValue([
      { kind: "ollama", label: "Ollama (self-hosted)", defaultModel: "translategemma:12b", configured: true },
      { kind: "gpt", label: "GPT / OpenAI", defaultModel: "gpt-4o", configured: false },
      { kind: "gemini", label: "Gemini", defaultModel: "gemini-2.5-pro", configured: false },
    ]);

    const res = await GET(makeRequest());
    const json = await res.json();

    expect(json.availableProviders).toEqual([
      { kind: "ollama", label: "Ollama (self-hosted)", defaultModel: "translategemma:12b", configured: true },
      { kind: "gpt", label: "GPT / OpenAI", defaultModel: "gpt-4o", configured: false },
      { kind: "gemini", label: "Gemini", defaultModel: "gemini-2.5-pro", configured: false },
    ]);
  });

  it("does not bother listing Ollama models when Ollama isn't a configured provider", async () => {
    vi.mocked(checkAdminSession).mockReturnValue(true);
    vi.mocked(isWixConfigured).mockReturnValue(false);
    vi.mocked(isTranslationProviderConfigured).mockReturnValue(false);
    vi.mocked(listAvailableTranslationProviders).mockReturnValue([
      { kind: "ollama", label: "Ollama (self-hosted)", defaultModel: "llama3.1", configured: false },
    ]);

    const res = await GET(makeRequest());
    const json = await res.json();

    expect(json.ollamaModels).toEqual([]);
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { stripCodeFence, parseTranslationResponse, TranslationProviderError } from "./translationProvider";

describe("stripCodeFence", () => {
  it("removes a ```json ... ``` markdown fence around the JSON payload", () => {
    const raw = '```json\n{"title": "Hello"}\n```';
    expect(stripCodeFence(raw)).toBe('{"title": "Hello"}');
  });

  it("removes a plain ``` fence without a language tag", () => {
    const raw = '```\n{"title": "Hello"}\n```';
    expect(stripCodeFence(raw)).toBe('{"title": "Hello"}');
  });

  it("returns the text unchanged when there is no fence", () => {
    const raw = '{"title": "Hello"}';
    expect(stripCodeFence(raw)).toBe(raw);
  });
});

describe("parseTranslationResponse", () => {
  it("parses a well-formed JSON object matching the requested keys", () => {
    const result = parseTranslationResponse('{"title": "Neat Bar", "series": "BYOD"}', ["title", "series"]);
    expect(result.fields).toEqual({ title: "Neat Bar", series: "BYOD" });
    expect(result.warnings).toEqual([]);
  });

  it("unwraps a JSON object inside a markdown code fence", () => {
    const result = parseTranslationResponse('```json\n{"title": "Neat Bar"}\n```', ["title"]);
    expect(result.fields.title).toBe("Neat Bar");
  });

  it("throws INVALID_RESPONSE for malformed JSON", () => {
    expect(() => parseTranslationResponse("not json at all", ["title"])).toThrow(TranslationProviderError);
    try {
      parseTranslationResponse("not json at all", ["title"]);
    } catch (err) {
      expect((err as TranslationProviderError).code).toBe("INVALID_RESPONSE");
    }
  });

  it("throws INVALID_RESPONSE when the JSON is an array instead of an object", () => {
    expect(() => parseTranslationResponse("[1,2,3]", ["title"])).toThrow(TranslationProviderError);
  });

  it("fills missing fields with an empty string and records a warning", () => {
    const result = parseTranslationResponse('{"title": "Neat Bar"}', ["title", "series"]);
    expect(result.fields).toEqual({ title: "Neat Bar", series: "" });
    expect(result.warnings.some((w) => w.includes("series"))).toBe(true);
  });

  it("drops unexpected extra fields and records a warning instead of including them", () => {
    const result = parseTranslationResponse('{"title": "Neat Bar", "hallucinated": "oops"}', ["title"]);
    expect(result.fields).toEqual({ title: "Neat Bar" });
    expect(result.warnings.some((w) => w.includes("hallucinated"))).toBe(true);
  });

  it("preserves empty string source values as empty string translations", () => {
    const result = parseTranslationResponse('{"title": ""}', ["title"]);
    expect(result.fields.title).toBe("");
  });

  it("coerces a non-string field value to a string and records a warning", () => {
    const result = parseTranslationResponse('{"title": 123}', ["title"]);
    expect(result.fields.title).toBe("123");
    expect(result.warnings.some((w) => w.includes("title"))).toBe(true);
  });
});

describe("provider selection (resolveProviderKind via getTranslationProviderKind)", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.TRANSLATION_PROVIDER;
    delete process.env.OLLAMA_BASE_URL;
    delete process.env.GPT_API_KEY;
    delete process.env.GEMINI_API_KEY;
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("returns null when nothing is configured", async () => {
    const mod = await import("./translationProvider");
    expect(mod.getTranslationProviderKind()).toBeNull();
    expect(mod.isTranslationProviderConfigured()).toBe(false);
  });

  it("prefers Ollama over GPT and Gemini when OLLAMA_BASE_URL is set", async () => {
    process.env.OLLAMA_BASE_URL = "http://localhost:11434";
    process.env.GPT_API_KEY = "gpt-key";
    process.env.GEMINI_API_KEY = "gemini-key";
    const mod = await import("./translationProvider");
    expect(mod.getTranslationProviderKind()).toBe("ollama");
  });

  it("prefers GPT over Gemini when Ollama isn't configured", async () => {
    process.env.GPT_API_KEY = "gpt-key";
    process.env.GEMINI_API_KEY = "gemini-key";
    const mod = await import("./translationProvider");
    expect(mod.getTranslationProviderKind()).toBe("gpt");
  });

  it("lets TRANSLATION_PROVIDER force Gemini even when Ollama and GPT are configured", async () => {
    process.env.OLLAMA_BASE_URL = "http://localhost:11434";
    process.env.GPT_API_KEY = "gpt-key";
    process.env.GEMINI_API_KEY = "gemini-key";
    process.env.TRANSLATION_PROVIDER = "gemini";
    const mod = await import("./translationProvider");
    expect(mod.getTranslationProviderKind()).toBe("gemini");
  });
});

describe("OllamaTranslationProvider (mocked fetch)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("requests think:false so hybrid-reasoning models (e.g. Qwen3) answer directly instead of burning the output budget on chain-of-thought", async () => {
    const { OllamaTranslationProvider } = await import("./translationProvider");
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ response: "Hello" }) });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OllamaTranslationProvider("http://localhost:11434", "qwen3.5:4b");
    await provider.translate({ fields: { title: "Xin chao" } });

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.think).toBe(false);
  });

  it("defaults to a Vietnamese -> English prompt when no locales are given", async () => {
    const { OllamaTranslationProvider } = await import("./translationProvider");
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ response: "Hello" }) });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OllamaTranslationProvider("http://localhost:11434", "llama3.1");
    await provider.translate({ fields: { title: "Xin chao" } });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.prompt).toContain("chuyên gia dịch thuật Việt–Anh");
    expect(body.prompt).toContain("từ tiếng Việt sang tiếng Anh");
  });

  it("builds the reverse English -> Vietnamese prompt when sourceLocale/targetLocale say so", async () => {
    const { OllamaTranslationProvider } = await import("./translationProvider");
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ response: "Xin chao" }) });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OllamaTranslationProvider("http://localhost:11434", "llama3.1");
    const result = await provider.translate({
      fields: { title: "Hello" },
      sourceLocale: "en",
      targetLocale: "vi",
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.prompt).toContain("chuyên gia dịch thuật Anh–Việt");
    expect(body.prompt).toContain("từ tiếng Anh sang tiếng Việt");
    expect(result.fields.title).toBe("Xin chao");
  });

  it("instructs the model not to substitute its own prior knowledge about the brand/product instead of translating literally", async () => {
    const { OllamaTranslationProvider } = await import("./translationProvider");
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ response: "Hello" }) });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OllamaTranslationProvider("http://localhost:11434", "qwen3.5:4b");
    await provider.translate({ fields: { title: "Xin chao" } });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.prompt).toContain("TUYỆT ĐỐI");
    expect(body.prompt).toContain("KHÔNG dùng kiến thức");
    expect(body.prompt).toMatch(/không phải viết lại|không phải viết lại, tóm tắt/i);
  });

  it("surfaces a done_reason:\"length\" empty response as an actionable INVALID_RESPONSE error", async () => {
    const { OllamaTranslationProvider } = await import("./translationProvider");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ response: "", thinking: "...", done_reason: "length" }) })
    );

    const provider = new OllamaTranslationProvider("http://localhost:11434", "qwen3.5:4b");
    await expect(provider.translate({ fields: { title: "Xin chao" } })).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
      message: expect.stringContaining("ran out of output tokens"),
    });
  });

  it("calls the native /api/generate endpoint once per non-empty field and returns plain-text translations", async () => {
    const { OllamaTranslationProvider } = await import("./translationProvider");
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      return {
        ok: true,
        status: 200,
        json: async () => ({ response: `EN: ${body.prompt.includes("Neat Bar") ? "Neat Bar" : "Overview"}` }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OllamaTranslationProvider("http://localhost:11434", "llama3.1");
    const result = await provider.translate({ fields: { title: "Neat Bar", productOverview: "", overview: "Mo ta" } });

    // Empty source fields are never sent to the model.
    expect(result.fields.productOverview).toBe("");
    expect(result.fields.title).toContain("Neat Bar");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:11434/api/generate");
  });

  it("sends an Authorization header only when an API key is provided", async () => {
    const { OllamaTranslationProvider } = await import("./translationProvider");
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ response: "Hello" }) });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OllamaTranslationProvider("http://localhost:11434", "llama3.1", "secret-token");
    await provider.translate({ fields: { title: "Xin chao" } });

    const [, init] = fetchMock.mock.calls[0];
    expect((init as RequestInit & { headers: Record<string, string> }).headers.Authorization).toBe("Bearer secret-token");
  });

  it("maps a 429 response to a RATE_LIMITED error", async () => {
    const { OllamaTranslationProvider } = await import("./translationProvider");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 429, text: async () => "rate limited" }));

    const provider = new OllamaTranslationProvider("http://localhost:11434", "llama3.1");
    await expect(provider.translate({ fields: { title: "Xin chao" } })).rejects.toMatchObject({
      code: "RATE_LIMITED",
    });
  });
});

describe("OllamaTranslationProvider — TranslateGemma model (mocked fetch)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("routes any model tag containing \"translategemma\" to /api/chat instead of /api/generate", async () => {
    const { OllamaTranslationProvider } = await import("./translationProvider");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ message: { role: "assistant", content: "Hello" } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OllamaTranslationProvider("http://localhost:11434", "translategemma:12b");
    const result = await provider.translate({ fields: { title: "Xin chao" } });

    expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:11434/api/chat");
    expect(result.fields.title).toBe("Hello");
  });

  it("sends TranslateGemma's required English prompt template with source/target language name + code", async () => {
    const { OllamaTranslationProvider } = await import("./translationProvider");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ message: { content: "Hello" } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OllamaTranslationProvider("http://localhost:11434", "translategemma:12b");
    await provider.translate({ fields: { title: "Xin chao" }, sourceLocale: "vi", targetLocale: "en" });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    const content = body.messages[0].content as string;
    expect(content).toContain("Vietnamese (vi) to English (en) translator");
    expect(content).toContain("Xin chao");
    expect(body.messages[0].role).toBe("user");
  });

  it("builds the reverse English -> Vietnamese prompt for TranslateGemma when locales say so", async () => {
    const { OllamaTranslationProvider } = await import("./translationProvider");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ message: { content: "Xin chao" } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OllamaTranslationProvider("http://localhost:11434", "translategemma:12b");
    const result = await provider.translate({
      fields: { title: "Hello" },
      sourceLocale: "en",
      targetLocale: "vi",
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.messages[0].content).toContain("English (en) to Vietnamese (vi) translator");
    expect(result.fields.title).toBe("Xin chao");
  });

  it("throws INVALID_RESPONSE when the chat response has no message content", async () => {
    const { OllamaTranslationProvider } = await import("./translationProvider");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ message: { content: "" } }) }));

    const provider = new OllamaTranslationProvider("http://localhost:11434", "translategemma:12b");
    await expect(provider.translate({ fields: { title: "Xin chao" } })).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });

  it("still uses /api/generate for a non-TranslateGemma model", async () => {
    const { OllamaTranslationProvider } = await import("./translationProvider");
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ response: "Hello" }) });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OllamaTranslationProvider("http://localhost:11434", "llama3.1");
    await provider.translate({ fields: { title: "Xin chao" } });

    expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:11434/api/generate");
  });
});

describe("length-drift guard (getTranslationProvider wraps every provider kind)", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
  });

  it("flags a translation that is far longer than its source as a warning, without treating it as a failure", async () => {
    process.env.OLLAMA_BASE_URL = "http://localhost:11434";
    const { getTranslationProvider } = await import("./translationProvider");

    const source = "Đây là mô tả sản phẩm ngắn gọn, chỉ vài dòng thôi.";
    const hallucinatedTranslation = "This is a much longer rewritten passage. ".repeat(10);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ response: hallucinatedTranslation }) })
    );

    const provider = getTranslationProvider({ kind: "ollama", model: "qwen3.5:4b" });
    const result = await provider.translate({ fields: { overview: source } });

    expect(result.fields.overview).toBe(hallucinatedTranslation.trim());
    expect(result.warnings.some((w) => w.includes("overview") && /dài .*x so với bản gốc/.test(w))).toBe(true);
  });

  it("does not warn when the translation length is proportionate to the source", async () => {
    process.env.OLLAMA_BASE_URL = "http://localhost:11434";
    const { getTranslationProvider } = await import("./translationProvider");

    const source = "Đây là mô tả sản phẩm ngắn gọn, chỉ vài dòng thôi.";
    const faithfulTranslation = "This is a short product description, just a few lines.";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ response: faithfulTranslation }) })
    );

    const provider = getTranslationProvider({ kind: "ollama", model: "qwen3.5:4b" });
    const result = await provider.translate({ fields: { overview: source } });

    expect(result.warnings).toEqual([]);
  });

  it("skips the length check for short source strings, where a length ratio isn't meaningful", async () => {
    process.env.OLLAMA_BASE_URL = "http://localhost:11434";
    const { getTranslationProvider } = await import("./translationProvider");

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ response: "Understood, thank you very much indeed." }) })
    );

    const provider = getTranslationProvider({ kind: "ollama", model: "qwen3.5:4b" });
    const result = await provider.translate({ fields: { ack: "OK" } });

    expect(result.warnings).toEqual([]);
  });
});

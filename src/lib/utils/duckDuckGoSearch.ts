/**
 * duckDuckGoSearch.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Free-tier web search (no API key, no paid quota): scrapes DuckDuckGo's
 * plain HTML result page for both the result title/link AND its
 * description snippet — the snippet is what actually lets an LLM verify or
 * discover real information without us having to fetch and parse the full
 * page. Used to give a self-hosted Ollama model real internet context it
 * has no way to fetch on its own (see categoryConsolidation.ts's
 * web-verified category clustering).
 *
 * Server-only: never import this from a Client Component.
 */

export interface DuckDuckGoSearchResult {
  title: string;
  url: string;
  snippet: string;
}

export async function searchDuckDuckGoWithSnippets(query: string, limit = 3): Promise<DuckDuckGoSearchResult[]> {
  const ddgUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(ddgUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.5",
      },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!res.ok) return [];

    const html = await res.text();
    const titleRegex = /<a\s+class="result__a"\s+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    const snippetRegex = /<a\s+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;

    const titles: { url: string; title: string }[] = [];
    let m: RegExpExecArray | null;
    while ((m = titleRegex.exec(html)) !== null) {
      let url = m[1];
      if (url.includes("uddg=")) {
        try {
          const u = new URL(url.startsWith("http") ? url : `https:${url}`);
          const uddg = u.searchParams.get("uddg");
          if (uddg) url = uddg;
        } catch {
          // keep the raw url if it can't be parsed as a redirect wrapper
        }
      }
      if (url.startsWith("//")) url = "https:" + url;
      titles.push({ url, title: m[2].replace(/<[^>]*>/g, "").trim() });
    }

    const snippets: string[] = [];
    while ((m = snippetRegex.exec(html)) !== null) {
      snippets.push(m[1].replace(/<[^>]*>/g, "").trim());
    }

    return titles
      .slice(0, limit)
      .map((t, i) => ({ title: t.title, url: t.url, snippet: snippets[i] || "" }))
      .filter((r) => r.url.startsWith("http"));
  } catch {
    clearTimeout(timeoutId);
    return [];
  }
}

async (page) => {
  // Cold-load lab measurement. Each run uses a fresh browser context (no cache).
  const BASE = 'http://localhost:3124';
  const ROUTES = ['/products/4-port-expander'];
  const PROFILES = {
    desktop: { viewport: { width: 1440, height: 900 }, cpu: 1, net: null },
    mobile: { viewport: { width: 375, height: 812 }, cpu: 4, net: { latency: 150, downloadThroughput: (9 * 1024 * 1024) / 8, uploadThroughput: (1.5 * 1024 * 1024) / 8 } },
  };
  const RUNS = 3;
  const browser = page.context().browser();
  const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  const results = {};
  for (const [pname, prof] of Object.entries(PROFILES)) {
    for (const route of ROUTES) {
      const samples = [];
      for (let i = 0; i < RUNS; i++) {
        const ctx = await browser.newContext({ viewport: prof.viewport });
        if (route !== '/login') await ctx.addCookies([{ name: 'admin_session', value: 'perf-audit', url: BASE }]);
        const p = await ctx.newPage();
        const cdp = await ctx.newCDPSession(p);
        await cdp.send('Network.enable');
        await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
        if (prof.net) await cdp.send('Network.emulateNetworkConditions', { offline: false, ...prof.net });
        if (prof.cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: prof.cpu });
        await p.addInitScript(() => {
          window.__lcp = 0; window.__cls = 0;
          new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lcp = e.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
          new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: 'layout-shift', buffered: true });
        });
        const resp = await p.goto(BASE + route, { waitUntil: 'networkidle', timeout: 120000 });
        await p.waitForTimeout(1500);
        const m = await p.evaluate(() => {
          const nav = performance.getEntriesByType('navigation')[0];
          const fcp = performance.getEntriesByName('first-contentful-paint')[0];
          const res = performance.getEntriesByType('resource');
          const sum = (f) => res.filter(f).reduce((a, r) => a + (r.transferSize || 0), 0);
          return {
            ttfb: nav.responseStart, fcp: fcp ? fcp.startTime : null, lcp: window.__lcp, cls: window.__cls,
            domContentLoaded: nav.domContentLoadedEventEnd, load: nav.loadEventEnd,
            htmlKB: nav.transferSize / 1024,
            jsKB: sum((r) => r.name.endsWith('.js')) / 1024,
            cssKB: sum((r) => r.name.endsWith('.css')) / 1024,
            fontKB: sum((r) => /\.woff2?$/.test(r.name)) / 1024,
            imgKB: sum((r) => r.initiatorType === 'img' || /\.(png|jpe?g|webp|avif|svg)/.test(r.name)) / 1024,
            jsFiles: res.filter((r) => r.name.endsWith('.js')).length,
            domNodes: document.getElementsByTagName('*').length,
          };
        });
        m.status = resp ? resp.status() : null;
        m.finalUrl = p.url().replace(BASE, '');
        samples.push(m);
        await ctx.close();
      }
      const keys = Object.keys(samples[0]).filter((k) => typeof samples[0][k] === 'number');
      const med = {};
      for (const k of keys) med[k] = Math.round(median(samples.map((s) => s[k] ?? 0)) * 1000) / 1000;
      med.status = samples[0].status; med.finalUrl = samples[0].finalUrl;
      med.lcpRuns = samples.map((s) => Math.round(s.lcp));
      results[`${pname} ${route}`] = med;
    }
  }
  return results;
}

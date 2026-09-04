/**
 * rateLimiter.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * A pacing gate for Wix Data API WRITES specifically — see
 * `wix-cms.service.ts`'s `updateWixCmsItemFields()`, its only caller.
 *
 * Wix's "requests per minute" quota (e.g. `WDE0014: Requests per minute quota
 * exceeded`) got hit during a bulk CMS-translation write run: up to 300 items
 * written back with a few requests in flight at once. Concurrency alone
 * doesn't prevent this — concurrency caps how many requests are in flight at
 * once, not how many happen per minute; a handful of fast, back-to-back PATCH
 * calls can still add up to a burst well past the quota. This gate paces the
 * actual write RATE instead, process-wide across every write.
 *
 * Deliberately scoped to writes only, not every Wix Data API call — ordinary
 * reads (dashboard stats, product listings, pagination loops) were never the
 * reported problem, and pacing them too would slow down normal page loads for
 * no benefit (this was tried and reverted — see git history on this file).
 *
 * Deliberately simple (no external queue library) — a single shared
 * `nextAllowedAt` timestamp, reserved synchronously before the `await`, which is
 * safe under Node's single-threaded event loop: nothing else can run between
 * reading and updating it.
 */

// Conservative default; override via WIX_MIN_WRITE_INTERVAL_MS if the real quota
// still isn't cleared, or safely lower it once the actual quota is known.
const MIN_INTERVAL_MS = Number(process.env.WIX_MIN_WRITE_INTERVAL_MS) || 350;

let nextAllowedAt = 0;

/** Waits, if necessary, so this Wix Data API write and every other one in this process stay paced at least MIN_INTERVAL_MS apart. */
export async function waitForWixWriteRateLimitSlot(): Promise<void> {
  const now = Date.now();
  const waitMs = Math.max(0, nextAllowedAt - now);
  nextAllowedAt = Math.max(now, nextAllowedAt) + MIN_INTERVAL_MS;
  if (waitMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
}

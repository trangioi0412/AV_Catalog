/**
 * LAN access ("link network", e.g. http://192.168.1.20:3000): PORTAL_URL is
 * configured as http://localhost:3100, which on another device points at
 * that device itself. When the configured URL is loopback and the visitor
 * reached this site through a private-network host, links to the portal use
 * the visitor's host with the configured port and protocol instead.
 *
 * Only redirect targets change: the SSO token issuer stays PORTAL_URL.
 * Public hosts never trigger the rewrite (a forged Host header cannot send
 * anyone to an arbitrary domain), and real domains in PORTAL_URL are kept.
 *
 * Same logic as AVS_Portal/src/lib/network-url.ts — keep them in sync.
 */

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** localhost, *.local, 127/8, 10/8, 172.16/12, 192.168/16. */
export function isLanHostname(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (LOOPBACK.has(h) || h.endsWith(".local")) return true;
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b, c, d] = m.slice(1).map(Number);
  if ([a, b, c, d].some((n) => n > 255)) return false;
  return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/** Hostname of a Host header value ("192.168.1.20:3000" -> "192.168.1.20"). */
export function hostnameOf(hostHeader: string | null | undefined): string {
  if (!hostHeader) return "";
  try {
    return new URL(`http://${hostHeader}`).hostname;
  } catch {
    return "";
  }
}

/** `baseUrl` as seen from the visitor's host; no trailing slash. */
export function forRequestHost(baseUrl: string, requestHost: string | null | undefined): string {
  const trimmed = baseUrl.replace(/\/$/, "");
  const host = hostnameOf(requestHost);
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return trimmed;
  }
  if (!host || host === url.hostname || !LOOPBACK.has(url.hostname) || !isLanHostname(host)) return trimmed;
  url.hostname = host;
  return url.toString().replace(/\/$/, "");
}

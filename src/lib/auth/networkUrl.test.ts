import { describe, expect, it } from "vitest";
import { forRequestHost, isLanHostname } from "./networkUrl";

describe("forRequestHost", () => {
  const portal = "http://localhost:3100";

  it("keeps localhost when the visitor uses localhost", () => {
    expect(forRequestHost(portal, "localhost:3000")).toBe(portal);
  });

  it("uses the visitor's LAN host with the configured port", () => {
    expect(forRequestHost(portal, "192.168.1.20:3000")).toBe("http://192.168.1.20:3100");
    expect(forRequestHost(portal + "/", "10.150.105.188:3000")).toBe("http://10.150.105.188:3100");
    expect(forRequestHost(portal, "may-dev.local:3000")).toBe("http://may-dev.local:3100");
  });

  it("never rewrites to a public host (forged Host header)", () => {
    expect(forRequestHost(portal, "evil.example.com")).toBe(portal);
    expect(forRequestHost(portal, "8.8.8.8:3000")).toBe(portal);
  });

  it("keeps a real domain in the configured URL", () => {
    expect(forRequestHost("https://portal.avs-tek.vn", "192.168.1.20:3000")).toBe("https://portal.avs-tek.vn");
  });

  it("ignores a missing or malformed Host", () => {
    expect(forRequestHost(portal, null)).toBe(portal);
    expect(forRequestHost(portal, "bad host")).toBe(portal);
  });
});

describe("isLanHostname", () => {
  it("accepts private ranges only", () => {
    expect(isLanHostname("172.16.13.121")).toBe(true);
    expect(isLanHostname("172.32.0.1")).toBe(false);
    expect(isLanHostname("192.169.0.1")).toBe(false);
    expect(isLanHostname("300.1.1.1")).toBe(false);
  });
});

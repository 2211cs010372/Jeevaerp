import { describe, it, expect, afterEach, vi } from "vitest";
import { portalUrl } from "@/lib/auth/portal-url";

/**
 * A cross-portal link that 404s is worse than no link: the desk clicks it,
 * lands on nothing, and stops trusting every other link on the page. These pin
 * the shapes this app is actually deployed in.
 */
const withHost = (host: string, protocol = "https:") => {
  vi.stubGlobal("window", { location: { host, protocol } });
};

afterEach(() => vi.unstubAllGlobals());

describe("portalUrl", () => {
  it("builds an absolute URL across subdomains on a custom domain", () => {
    withHost("reception.jeevamultispecialityhospital.com");
    expect(portalUrl("insurance", "/admissions/abc")).toBe(
      "https://insurance.jeevamultispecialityhospital.com/admissions/abc"
    );
  });

  it("swaps the portal label rather than prefixing it", () => {
    // The bug this replaces: a relative href from reception resolved to
    // reception.<root>/admissions/abc, which does not exist.
    withHost("reception.jeeva.com");
    expect(portalUrl("insurance", "/admissions/abc")).not.toContain("reception.jeeva.com");
  });

  it("keeps the dev port on localhost", () => {
    withHost("reception.localhost:3000", "http:");
    expect(portalUrl("insurance", "/admissions/abc")).toBe("http://insurance.localhost:3000/admissions/abc");
  });

  it("works from the bare root domain too", () => {
    withHost("jeeva.com");
    expect(portalUrl("insurance", "/claims")).toBe("https://insurance.jeeva.com/claims");
  });

  it("falls back to a path prefix where subdomains have no certificate", () => {
    withHost("jeeva-erp.vercel.app");
    expect(portalUrl("insurance", "/admissions/abc")).toBe("/insurance/admissions/abc");
  });

  it("falls back to a path prefix on a bare IP", () => {
    withHost("192.168.1.10:3000", "http:");
    expect(portalUrl("insurance", "/claims")).toBe("/insurance/claims");
  });

  it("returns a path when there is no window (SSR, tests)", () => {
    expect(portalUrl("insurance", "/claims")).toBe("/insurance/claims");
  });

  it("tolerates a path given without its leading slash", () => {
    withHost("reception.jeeva.com");
    expect(portalUrl("insurance", "claims")).toBe("https://insurance.jeeva.com/claims");
  });
});

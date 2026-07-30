import { describe, it, expect } from "vitest";
import {
  loginThrottle,
  throttleKey,
  LOGIN_WINDOW_MS,
  LOGIN_MAX_PER_USER,
  LOGIN_MAX_PER_IP,
} from "@/lib/auth/login-throttle";

/**
 * The throttle decision guards the admin account, so it gets the boundary
 * treatment: one attempt below the limit must still be allowed (a locked-out
 * receptionist at 7 AM is a real cost), and exactly at the limit must not.
 */

const now = new Date("2026-07-30T10:00:00Z");
const agoMs = (ms: number) => new Date(now.getTime() - ms);

const decide = (over: Partial<Parameters<typeof loginThrottle>[0]> = {}) =>
  loginThrottle({ userFails: 0, ipFails: 0, now, ...over });

describe("loginThrottle - the per-username limit", () => {
  it("allows a clean slate", () => {
    expect(decide().blocked).toBe(false);
  });

  it("allows the attempt one below the limit", () => {
    expect(decide({ userFails: LOGIN_MAX_PER_USER - 1 }).blocked).toBe(false);
  });

  it("blocks exactly at the limit", () => {
    const d = decide({ userFails: LOGIN_MAX_PER_USER });
    expect(d.blocked).toBe(true);
    expect(d.reason).toBe("username");
  });

  it("stays blocked above the limit", () => {
    expect(decide({ userFails: LOGIN_MAX_PER_USER + 500 }).blocked).toBe(true);
  });
});

describe("loginThrottle - the per-IP limit", () => {
  it("blocks a spray across many usernames even though no single one tripped", () => {
    // The attack the per-username limit cannot see: one password, many accounts.
    const d = decide({ userFails: 1, ipFails: LOGIN_MAX_PER_IP });
    expect(d.blocked).toBe(true);
    expect(d.reason).toBe("ip");
  });

  it("allows one below the IP limit", () => {
    expect(decide({ ipFails: LOGIN_MAX_PER_IP - 1 }).blocked).toBe(false);
  });

  it("is far looser than the per-user limit, so one NAT cannot lock a whole front desk", () => {
    expect(LOGIN_MAX_PER_IP).toBeGreaterThan(LOGIN_MAX_PER_USER);
  });

  it("names the username as the cause when both limits have tripped", () => {
    // The more specific reason is the more useful one in the audit row.
    const d = decide({ userFails: LOGIN_MAX_PER_USER, ipFails: LOGIN_MAX_PER_IP });
    expect(d.reason).toBe("username");
  });
});

describe("loginThrottle - the window slides", () => {
  it("waits only for the oldest failure to age out, not a fresh full window", () => {
    // Five minutes into a fifteen minute window: ten minutes left, not fifteen.
    const d = decide({
      userFails: LOGIN_MAX_PER_USER,
      oldestUserFailAt: agoMs(5 * 60 * 1000),
    });
    expect(d.retryAfterSec).toBe(10 * 60);
  });

  it("reports the full window when the oldest failure is unknown", () => {
    const d = decide({ userFails: LOGIN_MAX_PER_USER, oldestUserFailAt: null });
    expect(d.retryAfterSec).toBe(LOGIN_WINDOW_MS / 1000);
  });

  it("never reports zero seconds for a failure that has just aged out", () => {
    // Zero would tell the caller to retry immediately, be blocked again, and the
    // lockout would read as a broken login screen.
    const d = decide({
      userFails: LOGIN_MAX_PER_USER,
      oldestUserFailAt: agoMs(LOGIN_WINDOW_MS),
    });
    expect(d.retryAfterSec).toBeGreaterThanOrEqual(1);
  });

  it("uses the IP's own oldest failure when the IP limit tripped", () => {
    const d = decide({
      ipFails: LOGIN_MAX_PER_IP,
      oldestUserFailAt: agoMs(60_000),
      oldestIpFailAt: agoMs(3 * 60 * 1000),
    });
    expect(d.reason).toBe("ip");
    expect(d.retryAfterSec).toBe(12 * 60);
  });

  it("reports no wait when nothing is blocked", () => {
    expect(decide().retryAfterSec).toBe(0);
  });
});

describe("throttleKey - case variation is not a free bypass", () => {
  const cases = ["admin", "Admin", "ADMIN", "  admin  ", "aDmIn\t"];
  it("collapses every casing and padding to one counter", () => {
    const keys = new Set(cases.map(throttleKey));
    expect(keys).toEqual(new Set(["admin"]));
  });

  it("keeps genuinely different usernames apart", () => {
    expect(throttleKey("reception1")).not.toBe(throttleKey("reception2"));
  });

  it("passes an empty string through rather than throwing", () => {
    expect(throttleKey("   ")).toBe("");
  });
});

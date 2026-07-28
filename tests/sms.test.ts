import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { smsStatus } from "@/lib/sms";
import { toBare10, toMsisdn as toIndianMsisdn } from "@/lib/phone";

/**
 * The two providers disagree about what a phone number is.
 *
 * Fast2SMS wants a bare 10-digit Indian number and rejects a country code;
 * 2Factor requires the 91 prefix. Getting this wrong does not throw - the
 * provider accepts the request and the message simply never arrives, which is
 * the worst possible failure on an OTP path. Hence cases, not trust.
 */
describe("phone formatting for each provider", () => {
  const cases: [string, string, string][] = [
    // input,                fast2sms,       2factor
    ["9876543210",           "9876543210",   "919876543210"],
    ["919876543210",         "9876543210",   "919876543210"],
    ["+919876543210",        "9876543210",   "919876543210"],
    ["+91 98765 43210",      "9876543210",   "919876543210"],
    ["098765 43210",         "9876543210",   "919876543210"],
    ["+91-98765-43210",      "9876543210",   "919876543210"],
  ];

  for (const [input, bare, msisdn] of cases) {
    it(`"${input}" -> fast2sms ${bare} / 2factor ${msisdn}`, () => {
      expect(toBare10(input)).toBe(bare);
      expect(toIndianMsisdn(input)).toBe(msisdn);
    });
  }

  it("never leaves a country code on a Fast2SMS number", () => {
    for (const [input] of cases) {
      const out = toBare10(input);
      expect(out).toHaveLength(10);
      expect(out.startsWith("91")).toBe(false);
    }
  });

  it("never double-prefixes a 2Factor number", () => {
    for (const [input] of cases) {
      const out = toIndianMsisdn(input);
      expect(out).toHaveLength(12);
      expect(out.startsWith("9191")).toBe(false);
    }
  });
});

/**
 * Provider selection. The point of the fallback is that pasting one key in is
 * the whole migration - there must be no window where both are set and neither
 * is chosen, or where removing the old key silently disables SMS.
 */
describe("provider selection", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    delete process.env.FAST2SMS_API_KEY;
    delete process.env.TWO_FACTOR_API_KEY;
    delete process.env.SMS_PROVIDER;
    delete process.env.SMS_APPOINTMENT_TEMPLATE;
    delete process.env.SMS_OTP_TEMPLATE;
  });
  afterEach(() => { process.env = { ...saved }; });

  it("uses Fast2SMS when only its key is set", () => {
    process.env.FAST2SMS_API_KEY = "k";
    expect(smsStatus()).toMatchObject({ configured: true, provider: "fast2sms" });
  });

  it("falls back to 2Factor when only that key is set", () => {
    process.env.TWO_FACTOR_API_KEY = "k";
    expect(smsStatus()).toMatchObject({ configured: true, provider: "2factor" });
  });

  it("prefers Fast2SMS when BOTH are set - adding the new key is the migration", () => {
    process.env.FAST2SMS_API_KEY = "new";
    process.env.TWO_FACTOR_API_KEY = "old";
    expect(smsStatus().provider).toBe("fast2sms");
  });

  it("SMS_PROVIDER forces the older provider even with Fast2SMS present", () => {
    process.env.FAST2SMS_API_KEY = "new";
    process.env.TWO_FACTOR_API_KEY = "old";
    process.env.SMS_PROVIDER = "2factor";
    expect(smsStatus().provider).toBe("2factor");
  });

  it("a forced provider with no key reports unconfigured rather than silently using the other", () => {
    process.env.TWO_FACTOR_API_KEY = "old";
    process.env.SMS_PROVIDER = "fast2sms";
    expect(smsStatus()).toMatchObject({ configured: false, provider: null });
  });

  it("reports no provider when nothing is set", () => {
    expect(smsStatus()).toMatchObject({ configured: false, provider: null });
  });

  it("whitespace-only keys do not count as configured", () => {
    process.env.FAST2SMS_API_KEY = "   ";
    expect(smsStatus().configured).toBe(false);
  });

  it("OTPs take the plain otp route until a DLT template is registered", () => {
    process.env.FAST2SMS_API_KEY = "k";
    expect(smsStatus().otpRoute).toBe("otp");
  });

  it("SMS_OTP_TEMPLATE switches OTPs onto the DLT route", () => {
    // The escape hatch for a Fast2SMS account that has not completed website
    // verification and is refusing route=otp with status_code 996.
    process.env.FAST2SMS_API_KEY = "k";
    process.env.SMS_OTP_TEMPLATE = "1707161234567890";
    expect(smsStatus().otpRoute).toBe("dlt");
    delete process.env.SMS_OTP_TEMPLATE;
  });

  it("reports no OTP route when nothing is configured", () => {
    expect(smsStatus().otpRoute).toBeNull();
  });

  it("templateReady tracks the DLT template, separately from the OTP path", () => {
    process.env.FAST2SMS_API_KEY = "k";
    expect(smsStatus().templateReady).toBe(false);
    process.env.SMS_APPOINTMENT_TEMPLATE = "1707161234567890";
    expect(smsStatus().templateReady).toBe(true);
  });
});

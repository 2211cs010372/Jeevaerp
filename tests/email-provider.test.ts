import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { emailStatus, maskEmail } from "@/lib/email";

/**
 * WHICH TRANSPORT THE HOSPITAL IS ACTUALLY USING.
 *
 * This is the question behind "the report didn't arrive", and it is decided by
 * a handful of optional environment variables that nobody looks at twice. The
 * rules worth pinning down: SMTP wins when it is complete, a HALF-configured
 * SMTP block is not silently ignored in favour of Resend, and the sender
 * defaults to the mailbox on SMTP but never on Resend.
 */
const KEYS = [
  "SMTP_HOST", "SMTP_PORT", "SMTP_SECURE", "SMTP_USER", "SMTP_PASS",
  "RESEND_API_KEY", "EMAIL_FROM", "EMAIL_PROVIDER",
] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const smtp = () => {
  process.env.SMTP_HOST = "smtp.hostinger.com";
  process.env.SMTP_USER = "info@jeevamultispecialityhospital.com";
  process.env.SMTP_PASS = "mailbox-password";
};

describe("emailStatus - nothing configured", () => {
  it("reports not configured, and says so in words somebody can act on", () => {
    const s = emailStatus();
    expect(s.configured).toBe(false);
    expect(s.provider).toBeNull();
    expect(s.reason).toBe("No email provider is configured");
  });

  it("names the missing half rather than a blanket 'not configured'", () => {
    // The failure this prevents: an admin re-checking a key that is already
    // there because the message did not say which piece was absent.
    process.env.SMTP_HOST = "smtp.hostinger.com";
    process.env.SMTP_USER = "info@example.com";
    expect(emailStatus().reason).toContain("SMTP is half-configured");

    delete process.env.SMTP_HOST; delete process.env.SMTP_USER;
    process.env.RESEND_API_KEY = "re_x";
    expect(emailStatus().reason).toBe("EMAIL_FROM is not set");
  });
});

describe("emailStatus - SMTP", () => {
  it("is configured once host, user and password are all present", () => {
    smtp();
    const s = emailStatus();
    expect(s.configured).toBe(true);
    expect(s.provider).toBe("smtp");
    expect(s.host).toBe("smtp.hostinger.com:465");
  });

  it("defaults the sender to the mailbox itself", () => {
    // For SMTP the authenticated mailbox IS a valid sender, so this default is
    // honest - unlike Resend, where a default sender reaches nobody.
    smtp();
    expect(emailStatus().from).toBe("info@jeevamultispecialityhospital.com");
  });

  it("uses EMAIL_FROM when one is given", () => {
    smtp();
    process.env.EMAIL_FROM = "Jeeva Hospital <info@jeevamultispecialityhospital.com>";
    expect(emailStatus().from).toBe("Jeeva Hospital <info@jeevamultispecialityhospital.com>");
  });

  it("carries the port through, so a wrong one is visible on the screen", () => {
    smtp();
    process.env.SMTP_PORT = "587";
    expect(emailStatus().host).toBe("smtp.hostinger.com:587");
  });
});

describe("emailStatus - Resend and the choice between them", () => {
  it("needs both the key and a sender", () => {
    process.env.RESEND_API_KEY = "re_x";
    expect(emailStatus().configured).toBe(false);
    process.env.EMAIL_FROM = "Jeeva <reports@jeevamultispecialityhospital.com>";
    expect(emailStatus().provider).toBe("resend");
  });

  it("prefers SMTP when both are configured", () => {
    smtp();
    process.env.RESEND_API_KEY = "re_x";
    process.env.EMAIL_FROM = "Jeeva <reports@jeevamultispecialityhospital.com>";
    expect(emailStatus().provider).toBe("smtp");
  });

  it("EMAIL_PROVIDER forces the other one", () => {
    smtp();
    process.env.RESEND_API_KEY = "re_x";
    process.env.EMAIL_FROM = "Jeeva <reports@jeevamultispecialityhospital.com>";
    process.env.EMAIL_PROVIDER = "resend";
    expect(emailStatus().provider).toBe("resend");
  });

  it("forcing a provider that is not configured does NOT fall through to the other", () => {
    // Forcing is an instruction, not a preference. Falling back would send the
    // hospital's takings through a transport somebody deliberately turned off.
    smtp();
    process.env.EMAIL_PROVIDER = "resend";
    expect(emailStatus().configured).toBe(false);
  });
});

describe("maskEmail", () => {
  it("hides the local part without hiding which inbox it is", () => {
    expect(maskEmail("nagaruthwik@gmail.com")).toBe("n**********@gmail.com");
    expect(maskEmail("ab@x.com")).toBe("a**@x.com");
    expect(maskEmail("not-an-email")).toBe("•••");
  });
});

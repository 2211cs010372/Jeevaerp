/**
 * Brute-force throttling for the staff password login.
 *
 * The patient OTP path has been attempt-capped and rate-limited per phone since
 * it shipped (see otp.ts). The staff password path had nothing, so an admin
 * account - the one that can read every patient record in the hospital - was
 * open to an unlimited guessing loop over the public internet.
 *
 * TWO LIMITS, BECAUSE THERE ARE TWO ATTACKS.
 *
 *   per username  stops a guessing loop against one account (credential
 *                 stuffing, a leaked password list, a guessed "admin/admin123")
 *   per IP        stops the same attacker spraying one password across every
 *                 username they can think of, which never trips a per-username
 *                 limit at all
 *
 * Both are needed. Either one alone leaves the other attack wide open.
 */

/** How far back a failure still counts against you. */
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;

/**
 * Failures allowed per username per window.
 *
 * Eight is chosen for a hospital front desk, not for a bank: staff type their
 * password into a shared terminal at 7 AM with the caps lock on, and a limit of
 * three would lock out a receptionist during a queue. Eight is still far below
 * anything useful to an attacker, who needs thousands.
 *
 * Loose in development so nobody locks themselves out of their own machine while
 * testing the login screen. Same reasoning, and the same shape, as OTP_RATE_MAX.
 */
export const LOGIN_MAX_PER_USER = process.env.NODE_ENV === "production" ? 8 : 50;

/**
 * Failures allowed per IP per window, across all usernames.
 *
 * Deliberately much higher than the per-user limit: a hospital's whole staff can
 * sit behind one NAT address, so this must not turn one person's bad morning into
 * a lockout for the entire front desk. It only needs to be low enough to make
 * spraying pointless.
 */
export const LOGIN_MAX_PER_IP = process.env.NODE_ENV === "production" ? 30 : 200;

export interface ThrottleInput {
  /** Failed attempts for this username inside the window. */
  userFails: number;
  /** Failed attempts from this IP inside the window, all usernames. */
  ipFails: number;
  /** Oldest failure still inside the window, per key. Null when there are none. */
  oldestUserFailAt?: Date | null;
  oldestIpFailAt?: Date | null;
  now: Date;
}

export interface ThrottleDecision {
  blocked: boolean;
  /** Which limit tripped. Never shown to the caller; used for the audit row. */
  reason?: "username" | "ip";
  /** Seconds until the oldest failure ages out and a retry is worth making. */
  retryAfterSec: number;
}

/**
 * Decide whether this login attempt is allowed.
 *
 * Pure, so the decision can be tested without a database. The window is a
 * SLIDING one: the wait is until the oldest counted failure ages out, not a flat
 * penalty, so somebody who mistyped their password five minutes ago waits ten
 * minutes rather than a fresh fifteen.
 *
 * Username is checked before IP so that the audit row names the more specific
 * cause when both have tripped.
 */
export function loginThrottle(input: ThrottleInput): ThrottleDecision {
  const { userFails, ipFails, oldestUserFailAt, oldestIpFailAt, now } = input;

  const secsUntilClear = (oldest?: Date | null): number => {
    if (!oldest) return Math.ceil(LOGIN_WINDOW_MS / 1000);
    const clearsAt = oldest.getTime() + LOGIN_WINDOW_MS;
    // Never report 0: a caller told to retry in zero seconds retries immediately
    // and is blocked again, which reads as a broken login rather than a lockout.
    return Math.max(1, Math.ceil((clearsAt - now.getTime()) / 1000));
  };

  if (userFails >= LOGIN_MAX_PER_USER) {
    return { blocked: true, reason: "username", retryAfterSec: secsUntilClear(oldestUserFailAt) };
  }
  if (ipFails >= LOGIN_MAX_PER_IP) {
    return { blocked: true, reason: "ip", retryAfterSec: secsUntilClear(oldestIpFailAt) };
  }
  return { blocked: false, retryAfterSec: 0 };
}

/**
 * The key a username is counted under.
 *
 * Lowercased and trimmed, so `Admin`, `admin` and ` admin ` share one counter.
 * Without this, case variation is a free bypass: eight guesses per casing gives
 * an attacker as many attempts as they have patience for.
 *
 * This is the THROTTLE key only. The user lookup still uses the username exactly
 * as typed, so nothing about who can sign in changes.
 */
export function throttleKey(username: string): string {
  return username.trim().toLowerCase();
}

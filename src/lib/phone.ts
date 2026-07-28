/**
 * ONE DEFINITION OF A PHONE NUMBER.
 *
 * Every mobile in this system is STORED in E.164 with the Indian country code:
 *
 *     +919876543210
 *
 * and converted at the edges to whatever a particular consumer needs. Before
 * this module existed, four files each had their own `normalisePhone` doing
 * `.replace(/\D/g,"").slice(-10)`, and lib/sms.ts had two more conversions on
 * top - which is exactly how a number ends up written one way and looked up
 * another.
 *
 * WHY THE STORED FORM CARRIES THE COUNTRY CODE
 *
 * A bare "9876543210" is only meaningful if you already know the country. It is
 * fine right up until the first patient with an international number, at which
 * point there is no way to tell a 10-digit Indian mobile from a truncated
 * foreign one, and no safe migration either, because the information needed to
 * disambiguate was never stored. E.164 is unambiguous by construction.
 *
 * WHAT THIS DOES NOT CHANGE
 *
 * SMS delivery. lib/sms.ts already converts per provider - Fast2SMS wants a bare
 * 10-digit number, 2Factor wants "91…" - and it will keep doing that whatever
 * the column holds. Storing +91 is about the data being unambiguous, not about
 * getting a message onto a handset.
 *
 * THE RULE FOR CALLERS
 *
 *   Writing to the database, or matching a row?   toE164()
 *   Showing it to a human, or handing to Fast2SMS? toBare10()
 *   Handing to 2Factor?                            toMsisdn()
 *
 * Never compare two phone strings directly. Normalise both, then compare.
 */

/**
 * Digits only, country code and dialling prefixes stripped.
 * "+91 98765 43210" -> "9876543210".
 *
 * Strips only what it RECOGNISES - leading zeros, and a 91 country code on an
 * otherwise correct-length number. It deliberately does not take the last ten
 * digits of anything longer: an eleven-digit typo would then be truncated into a
 * different, entirely valid-looking number, and the OTP would be sent to a
 * stranger. Over-length input comes back over-length so isIndianMobile() can
 * reject it.
 */
export function toBare10(input: string | null | undefined): string {
  let d = String(input ?? "").replace(/\D/g, "");
  // A leading 0 (domestic dialling) or 00 (ISD) is how it is dialled, not part
  // of the number.
  d = d.replace(/^0+/, "");
  // "919876543210" -> "9876543210", but only at exactly the length that makes
  // the 91 a country code rather than the first two digits of something else.
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  return d;
}

/**
 * STORAGE FORM. "9876543210" -> "+919876543210".
 *
 * Returns "" for anything that is not a plausible Indian mobile, so a caller
 * that forgets to validate writes an empty string rather than "+91undefined" or
 * a half-number that will never match anything again.
 */
export function toE164(input: string | null | undefined): string {
  const ten = toBare10(input);
  return isIndianMobile(ten) ? `+91${ten}` : "";
}

/** 2Factor's form: "919876543210", no plus. */
export function toMsisdn(input: string | null | undefined): string {
  const ten = toBare10(input);
  return ten ? `91${ten}` : "";
}

/**
 * Indian mobile numbers are ten digits beginning 6-9. Landlines and short codes
 * are not accepted: this is used on OTP paths, and a number that cannot receive
 * an SMS is not a number a patient can log in with.
 */
export function isIndianMobile(input: string | null | undefined): boolean {
  return /^[6-9]\d{9}$/.test(toBare10(input));
}

/**
 * Human display: "98765 43210". The country code is noise on a screen where
 * every number is Indian, and the space is where people naturally break it.
 */
export function formatPhone(input: string | null | undefined): string {
  const ten = toBare10(input);
  return ten.length === 10 ? `${ten.slice(0, 5)} ${ten.slice(5)}` : String(input ?? "");
}

/**
 * Every stored form a number could plausibly have, for WHERE … IN lookups.
 *
 * Needed because rows written before the +91 migration - and any written by a
 * path that is still being updated - hold the bare ten digits. Matching on the
 * canonical form alone would silently fail to find an existing patient and let
 * the booking flow create a duplicate record, which is a clinical safety problem
 * and not merely untidy data.
 */
export function phoneVariants(input: string | null | undefined): string[] {
  const ten = toBare10(input);
  if (!ten) return [];
  return [`+91${ten}`, `91${ten}`, ten];
}

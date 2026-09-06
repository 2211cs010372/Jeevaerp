/**
 * WHO SENT THIS PATIENT IN - and which of the two records answers that.
 *
 * ─── THE PROBLEM THIS SOLVES ───────────────────────────────────────────────
 * "Referred by" is captured in TWO places, by two different desks:
 *
 *   Patient.referredByName      typed once at registration (reception/register)
 *   Appointment.referredByName  typed per visit at booking  (reception/book)
 *
 * In practice the registration form is the one that gets filled - somebody who
 * has already written "Dr. Anil" while creating the patient does not write it
 * again on every visit. Measured on this hospital's own data: 275 of 513
 * patients carry a referral, and 0 of 259 appointments do.
 *
 * So the admin appointments screen, which read only the appointment, showed
 * every single visit as "Walk-in" and hid its referrer ranking entirely. The
 * hospital's referral data was all there; nothing was reading it.
 *
 * ─── THE RULE ──────────────────────────────────────────────────────────────
 * The visit wins when it names somebody, because a per-visit referral is the
 * more specific fact: a long-standing patient sent in this once by a different
 * doctor should be attributed to that doctor for that visit. Otherwise the
 * patient record answers.
 *
 * AND THE NAME AND THE SOURCE COME FROM THE SAME RECORD, always. Taking the
 * name from the visit and the source from the patient would print "Dr. Anil /
 * WALK IN" out of two unrelated facts - a sentence neither desk ever typed.
 *
 * `fromPatient` is carried so the screen can SAY which record answered. It
 * matters: a referral on the patient repeats on every later visit, so a tally
 * built on it counts VISITS SENT IN, not new patients referred - and those are
 * different numbers if anybody is ever paid per referral.
 */

export interface ReferralFields {
  referredByName: string | null;
  referralSource: string | null;
}

export interface ReferralSnapshot {
  name: string | null;
  source: string | null;
  /** true when this came from the patient record rather than the visit. */
  fromPatient: boolean;
}

/** Blank and whitespace-only are both "not filled in". */
const clean = (s: string | null | undefined): string | null => {
  const t = s?.trim();
  return t ? t : null;
};

export function resolveReferral(
  visit: ReferralFields | null | undefined,
  patient: ReferralFields | null | undefined
): ReferralSnapshot {
  const visitName = clean(visit?.referredByName);
  if (visitName) {
    return { name: visitName, source: clean(visit?.referralSource), fromPatient: false };
  }

  const patientName = clean(patient?.referredByName);
  if (patientName) {
    return { name: patientName, source: clean(patient?.referralSource), fromPatient: true };
  }

  // No name anywhere. A source on its own ("WALK IN", "camp") is still worth
  // showing - it is what the desk recorded - but it names nobody, so it can
  // never be attributed to a referrer or counted in a ranking.
  const source = clean(visit?.referralSource);
  if (source) return { name: null, source, fromPatient: false };

  const patientSource = clean(patient?.referralSource);
  if (patientSource) return { name: null, source: patientSource, fromPatient: true };

  return { name: null, source: null, fromPatient: false };
}

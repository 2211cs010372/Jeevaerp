/**
 * THE HOSPITAL REFERRING ITS OWN SAMPLE.
 *
 * A ward sends one down, a camp collects one, the desk takes one against the
 * hospital's own name. None of those is a doctor on the roster and none of them
 * is self-referral, but every one printed "Ref. Doctor: Self / walk-in" - which
 * tells whoever reads the report that the patient turned up off the street.
 *
 * A SENTINEL, NOT AN ID. `LabTest.referringDoctorId` is a foreign key and this
 * value never reaches it: the service recognises it and writes the hospital's
 * name to `LabTest.referringName` instead.
 *
 * It lives in its own module rather than beside the `<select>` that offers it
 * because the server has to recognise the same string, and the select is a
 * client component - importing a "use client" module into a service drags the
 * whole component graph across the boundary with it.
 */
export const IN_HOUSE_REFERRER = "__IN_HOUSE__";

/** True when the desk picked "this hospital" rather than a doctor. */
export const isInHouseReferrer = (v: string | null | undefined): boolean =>
  v === IN_HOUSE_REFERRER;

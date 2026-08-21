/**
 * The insurers, TPAs and government schemes a hospital front office deals with.
 *
 * Lives in lib rather than in the insurance service because the FRONT DESK needs
 * it now - the admission form asks who the insurer is, and importing a server
 * service into a client component to get a string array would drag Prisma into
 * the browser bundle.
 *
 * ONE LIST, THREE DOORS. Reception's admission form imports it straight
 * (`reception/ipd`), the insurance desk's ward view imports it straight
 * (`insurance/ipd`), and the claim form is handed it over the API
 * (`/api/v1/insurance` returns it as `insurers`). Adding a name here reaches all
 * three - there is no second copy to keep in step.
 *
 * A SUGGESTION LIST, NEVER A CONSTRAINT. Every field that uses it accepts a
 * free-typed name: a hospital meets a TPA that is not on this list every few
 * months, and an admission must never be blocked because a dropdown is stale.
 * Nothing validates against it and nothing stores an id from it - what is kept
 * on the admission and on the claim is the typed string itself.
 *
 * Which of these the hospital is actually empanelled with is a different
 * question, and not one a suggestion list should pretend to answer. A name being
 * here means "somebody may type this", not "we do cashless with them".
 */

/** Health and general insurers who write the policy themselves. */
const COMPANIES = [
  "Star Health", "HDFC ERGO", "ICICI Lombard", "Bajaj Allianz", "Care Health",
  "Niva Bupa", "Aditya Birla Health", "ManipalCigna Health", "Tata AIG",
  "SBI General", "Reliance General", "Future Generali", "Cholamandalam MS",
  "IFFCO Tokio", "Royal Sundaram", "Universal Sompo", "Liberty General",
  "Kotak General", "Magma HDI", "Raheja QBE", "Go Digit", "Zuno General",
  "Shriram General", "Acko General", "Navi General",
];

/**
 * The four public-sector general insurers, kept together because a family says
 * "government insurance" and means one of these - and they are the four whose
 * names are close enough to each other to be picked wrong in a hurry.
 */
const PUBLIC_SECTOR = [
  "New India Assurance", "United India Insurance",
  "Oriental Insurance", "National Insurance",
];

/**
 * Third-party administrators. Suffixed "(TPA)" on purpose: several of these
 * share a word with an insurer above - Health India, Good Health, Vidal - and a
 * claim addressed to the wrong one of the pair comes straight back.
 *
 * "Paramount TPA" AND "Health India TPA" KEEP THEIR OLD SPELLING, without the
 * brackets the rest carry. They are not a style slip left uncorrected - the
 * analytics board groups by the insurer STRING (one row per insurer, worst payer
 * first), and admissions and claims already in the database carry these two
 * exactly as typed. Re-spelling the suggestion would leave every stay booked
 * before today under one name and every stay after it under another, and the
 * board would show a TPA owing half of what it owes, twice.
 */
const TPAS = [
  "Medi Assist (TPA)", "Paramount TPA", "Health India TPA", "Vidal Health (TPA)",
  "MDIndia (TPA)", "Family Health Plan (TPA)", "Heritage Health (TPA)",
  "Raksha Health (TPA)", "Ericson (TPA)", "Good Health (TPA)", "Safeway (TPA)",
  "Genins India (TPA)", "Park Mediclaim (TPA)", "Vipul MedCorp (TPA)",
  "East West Assist (TPA)", "Alankit Health Care (TPA)",
  "Health Insurance TPA of India", "Dedicated Healthcare Services (TPA)",
  "Sri Gokulam Health Services (TPA)", "Medvantage (TPA)",
];

/**
 * Government and employer schemes. Not insurers at all - they are reimbursed on
 * their own rate cards and their own paperwork - but the admission form asks one
 * question, "who is paying", and a receptionist admitting an Aarogyasri patient
 * has nowhere else to put that answer.
 *
 * The Telangana schemes are here because this hospital is in Telangana. EHS
 * covers serving and retired state employees and EJHS covers accredited
 * journalists; both are worked like Aarogyasri and are the two most often typed
 * in by hand before they were on this list.
 */
const SCHEMES = [
  "Aarogyasri (State scheme)", "Ayushman Bharat PM-JAY",
  "EHS (Telangana employees)", "EJHS (Telangana journalists)",
  "ESIC", "CGHS", "ECHS", "Indian Railways (IRHS)",
];

export const INSURERS = [...COMPANIES, ...PUBLIC_SECTOR, ...TPAS, ...SCHEMES] as const;

/** Which built-in group a name came from, so the manage screen can say so. */
export const BUILT_IN_KIND: Record<string, InsurerKind> = Object.fromEntries([
  ...COMPANIES.map((n) => [n, "COMPANY"] as const),
  ...PUBLIC_SECTOR.map((n) => [n, "PUBLIC_SECTOR"] as const),
  ...TPAS.map((n) => [n, "TPA"] as const),
  ...SCHEMES.map((n) => [n, "SCHEME"] as const),
]);

export type InsurerKind = "COMPANY" | "PUBLIC_SECTOR" | "TPA" | "SCHEME";

/** What each group is called on the manage screen. */
export const KIND_LABEL: Record<InsurerKind, string> = {
  COMPANY: "Insurance company",
  PUBLIC_SECTOR: "Public-sector insurer",
  TPA: "TPA",
  SCHEME: "Government / employer scheme",
};

/** A row of the hospital's own list, as much of it as the merge reads. */
export interface InsurerRow {
  name: string;
  active: boolean;
}

/** Two names are the same insurer if they differ only in case or in spacing. */
export const insurerKey = (n: string) => n.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * ── THE LIST EVERY "INSURER / TPA" BOX ACTUALLY SHOWS ──
 *
 * The hardcoded names above, plus whatever the hospital has added, minus
 * whatever it has switched off. Pure, and separate from the query that fetches
 * the rows, because this is the rule three screens depend on and none of them
 * should have to run a database to be sure of it.
 *
 * THE BUILT-IN LIST IS THE FLOOR, not a seed. A row here can HIDE one of those
 * names - that is what a stored row with active false and a built-in name means,
 * and it is the only way to hide one, since there is no row to delete - but
 * nothing else about the stored list can take a suggestion away. An empty table
 * gives you exactly the built-in list; so does a table nobody has curated.
 *
 * ORDER IS BUILT-INS FIRST, IN THEIR OWN ORDER, then the hospital's own names in
 * the order the caller supplied. A datalist is read top-down by somebody in a
 * hurry, and the twenty names that cover most admissions should not be pushed
 * below the one a desk added last Tuesday.
 */
export function mergeInsurers(rows: readonly InsurerRow[]): string[] {
  const stored = new Map<string, InsurerRow>();
  for (const r of rows) if (r.name.trim()) stored.set(insurerKey(r.name), r);

  const out: string[] = [];
  const seen = new Set<string>();

  for (const name of INSURERS) {
    const override = stored.get(insurerKey(name));
    if (override && !override.active) continue;
    out.push(name);
    seen.add(insurerKey(name));
  }
  for (const r of rows) {
    const k = insurerKey(r.name);
    if (!r.active || !r.name.trim() || seen.has(k)) continue;
    out.push(r.name.trim());
    seen.add(k);
  }
  return out;
}

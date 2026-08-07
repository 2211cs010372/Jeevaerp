/**
 * A short code for a lab test, suggested from its name.
 *
 * Every test carries one: the seed upserts on it, the price carryover keys on
 * it, and the printed report looks up its department and specimen band by it.
 * Asking a technician adding "Absolute Eosinophil Count" at a bench to also
 * invent a unique short code is asking them to know a convention nobody wrote
 * down - so this reads the convention off the name instead.
 *
 * THE HOSPITAL ALREADY WRITES THE CODE IN THE NAME. Its own menu is full of
 * "Post Lunch Blood Sugar (PLBS)", "C-Reactive Protein (CRP)", "Absolute
 * Eosinophil Count (AEC)" - the acronym is right there in the brackets. So the
 * first rule is simply to use it when it is there, which is why the suggestions
 * come out matching the codes the catalogue was seeded with rather than
 * competing with them.
 *
 * Failing that, initials: "Complete Blood Picture" -> CBP, "Liver Function
 * Test" -> LFT. Failing THAT - a one-word name - the word itself, trimmed.
 *
 * A suggestion is all this is. It fills the field; the technician can type over
 * it, and an existing test's code is never rewritten behind their back.
 */

/**
 * Words that are in almost every test name and so distinguish nothing. Dropped
 * before initials are taken, or "Complete Blood Picture" and "Complete Blood
 * Count" would both be CBC-shaped noise.
 */
const NOISE = new Set([
  "TEST", "TESTS", "PROFILE", "PANEL", "SCREENING", "SCREEN", "ESTIMATION",
  "ANALYSIS", "EXAMINATION", "AND", "THE", "OF", "FOR", "WITH", "A", "IN",
]);

/** Sex and age qualifiers become a suffix, so male and female forms differ. */
const QUALIFIER: Record<string, string> = {
  MALE: "M",
  FEMALE: "F",
  ADULT: "A",
  ADULTS: "A",
  INFANT: "I",
  INFANTS: "I",
  PAEDIATRIC: "PED",
  PEDIATRIC: "PED",
  CHILD: "PED",
  CHILDREN: "PED",
};

const clean = (s: string) => s.toUpperCase().replace(/[^A-Z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

/**
 * The code this name suggests, or "" when the name is empty.
 *
 * Never longer than 20 characters, because that is what the column holds and
 * what the validator allows.
 */
export function suggestTestCode(name: string): string {
  const raw = (name ?? "").trim();
  if (!raw) return "";

  // Every bracketed group, in order: "Haemogram (2 - 6 years)" -> ["2 - 6 YEARS"]
  const brackets = [...raw.matchAll(/\(([^)]*)\)/g)].map((m) => clean(m[1])).filter(Boolean);

  // 1. The hospital's own acronym, when it wrote one: "... (PLBS)" -> PLBS.
  //    Recognised by being a single short all-caps word in the ORIGINAL text -
  //    "(Male)" and "(Urine Pregnancy)" are qualifiers, not codes.
  //
  //    Punctuation is dropped from it: the catalogue writes "Bleeding Time &
  //    Clotting Time (BT-CT)" and codes it BTCT, and a suggestion that handed
  //    the next technician "BT-CT" would be a second convention for one thing.
  for (const m of raw.matchAll(/\(([^)]*)\)/g)) {
    const inner = m[1].trim();
    if (/^[A-Z0-9][A-Z0-9.\-/]{1,9}$/.test(inner) && /[A-Z]/.test(inner)) {
      return inner.replace(/[^A-Z0-9]/g, "").slice(0, 20);
    }
  }

  // 2. A qualifier in brackets becomes the suffix; the rest of the name, the stem.
  const suffix = brackets.map((b) => QUALIFIER[b]).find(Boolean) ?? "";
  const stem = clean(raw.replace(/\([^)]*\)/g, ""));

  const all = stem.split(" ").filter(Boolean);
  if (!all.length) return "";
  const sig = all.filter((w) => !NOISE.has(w));

  // Three words or more and the initials ARE the code, noise included: this
  // lab's own "Liver Function Test" is LFT, not LF. Dropping the common word
  // only earns its keep on a short name, where it is what turns "Widal Test"
  // into WIDAL and "Gravindex Test" into GRAVINDEX rather than WT and GT.
  const use = all.length >= 3 ? all : sig.length ? sig : all;

  const base = use.length >= 2
    ? use.map((w) => w[0]).join("").slice(0, 12)   // initials: CBP, LFT, RBS
    : use[0].slice(0, 12);                          // one word: GRAVINDEX

  return (suffix ? `${base}-${suffix}` : base).slice(0, 20);
}

/**
 * `suggestTestCode`, made unique against the codes already in use.
 *
 * Collisions are real and not rare - "Complete Blood Picture (Male)" and
 * "Complete Blood Count (Male)" both suggest CBP-M - and a duplicate code is not
 * a cosmetic problem: the seed upserts on it, so two tests sharing one would
 * overwrite each other's analytes the next time the catalogue is applied.
 *
 * `taken` is compared case-insensitively, because the column is not.
 */
export function uniqueTestCode(name: string, taken: Iterable<string | null | undefined>): string {
  const base = suggestTestCode(name);
  if (!base) return "";
  const used = new Set(
    [...taken].filter((c): c is string => !!c && !!c.trim()).map((c) => c.trim().toUpperCase()),
  );
  if (!used.has(base)) return base;
  for (let n = 2; n < 100; n++) {
    // Trim the base, not the counter: a truncated "-17" is a different test's code.
    const suffix = `-${n}`;
    const candidate = `${base.slice(0, 20 - suffix.length)}${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
  return "";
}

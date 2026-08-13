/**
 * WHICH PRICES ACTUALLY MOVED.
 *
 * The price grid posts every row it is holding, not just the ones that were
 * touched - the browser has no reliable idea which inputs a person visited, and
 * asking it to track that is how a genuine edit gets dropped because a blur
 * event did not fire. So the decision about what is a real correction is made
 * here, from the two sets of numbers, and it is made the same way on both sides
 * of the wire: the screen uses it to label the Save button, the server uses it
 * to decide what to write and what to log.
 *
 * Kept out of the service, and out of the component, so it can be tested the way
 * everything else that touches money in this codebase is tested - in
 * microseconds, with no database. See tests/lab-price.test.ts.
 */

/**
 * A price, or null for anything that is not one.
 *
 * THE EMPTY STRING IS NOT ZERO, and JavaScript disagrees: `Number("")` is 0,
 * finite and perfectly well-behaved. So a cleared price box, passed anywhere
 * that trusts Number(), reads as the decision "this test is free" - which is the
 * exact bug this whole screen exists to fix, arriving through the fix. Blank
 * means the person has not said yet.
 *
 * "6.5.0" is the other one. The grid's input filter strips letters but not a
 * second decimal point, so a fat-fingered rate parses to NaN - and a row that
 * quietly declines to be a number is a row Save skips without saying so. The
 * screen uses this to mark it instead.
 */
export function parsePrice(v: number | string): number | null {
  if (typeof v === "string" && v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** The same value in whole paise, which is the only unit money compares in. */
function paise(v: number | string): number | null {
  const n = parsePrice(v);
  return n === null ? null : Math.round(n * 100);
}

/**
 * Is this the same price, in the only unit that exists?
 *
 * Compared as whole paise rather than as floats. Two reasons, both real:
 * "400" and "400.00" are one price typed two ways, and 0.1 + 0.2 is not 0.3 in
 * binary floating point - a grid that compared raw numbers would offer to save
 * rows nobody had touched, and the audit log would fill up with them.
 *
 * Anything that is not a price - blank, a stray letter - is never "the same" as
 * anything, including another blank. There is nothing to compare, and answering
 * true would let a row that says nothing pass for a row that agrees.
 */
export function samePaise(a: number | string, b: number | string): boolean {
  const x = paise(a), y = paise(b);
  if (x === null || y === null) return false;
  return x === y;
}

export interface PriceChange {
  id: string;
  name: string;
  /** The catalogue's price before this submit. */
  from: number;
  /** What it is being corrected to. */
  to: number;
}

/**
 * The subset of `submitted` that differs from what the catalogue currently says.
 *
 * A submitted id with no matching catalogue row is SKIPPED rather than guessed
 * at - the caller checks for that separately and refuses the whole submit, so a
 * stale page cannot half-apply. Anything not submitted is left alone entirely:
 * this never reads as "delete the rest".
 */
export function priceChanges(
  existing: { id: string; name: string; price: number | string }[],
  submitted: { id: string; price: number }[],
): PriceChange[] {
  const byId = new Map(existing.map((e) => [e.id, e]));
  const out: PriceChange[] = [];
  for (const s of submitted) {
    const row = byId.get(s.id);
    if (!row) continue;
    if (samePaise(row.price, s.price)) continue;
    out.push({ id: s.id, name: row.name, from: Number(row.price), to: s.price });
  }
  return out;
}

/** The first id sent twice in one submit, or null. Two prices for one test is */
/** not a correction anyone meant to make, and the last one silently winning is */
/** the worst of the available outcomes. */
export function duplicateId(ids: string[]): string | null {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) return id;
    seen.add(id);
  }
  return null;
}

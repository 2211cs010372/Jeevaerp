import { describe, it, expect, vi } from "vitest";

/**
 * HOW A STAY'S DAYS ARE SHARED BETWEEN BEDS.
 *
 * The bug this file locks shut: every leg used to be priced on its own with
 * stayDays(), and stayDays() has a `Math.max(1, ...)` floor - a stay is never
 * billed as zero days. Correct for a stay. Ruinous for a leg. A patient moved
 * from a general ward to a sharing room twenty minutes after admission was
 * billed one full day of each: JMH2026IP00016 came to Rs 6,300 for a stay of
 * one day, and the family was asked for a night nobody spent.
 *
 * The floor belongs on the WHOLE stay, once. So the total is computed first and
 * then handed out, one day at a time, to whichever bed held the patient for
 * most of that day. The days therefore always add back up to the stay - that is
 * the property worth protecting, and every case below checks it.
 *
 * The service reaches Prisma at import time, so the client is stubbed.
 */

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const { splitStayDays, stayDays } = await import("@/server/services/ipd.service");

const at = (s: string) => new Date(`2026-08-${s}`);
const leg = (from: string, to: string | null) => ({ fromDate: at(from), toDate: to ? at(to) : null });

/** Days handed out must equal days billed. Nothing invented, nothing lost. */
const conserves = (admitted: Date, end: Date, legs: { fromDate: Date; toDate: Date | null }[]) =>
  splitStayDays(admitted, end, legs).reduce((a, b) => a + b, 0) === stayDays(admitted, end);

describe("splitStayDays - the case that was overbilling", () => {
  it("a move minutes after admission bills one day, not two", () => {
    const admitted = at("01T10:00:00");
    const end = at("01T18:00:00");
    const legs = [leg("01T10:00:00", "01T10:20:00"), leg("01T10:20:00", null)];

    expect(stayDays(admitted, end)).toBe(1);
    expect(splitStayDays(admitted, end, legs)).toEqual([0, 1]);
  });

  it("gives the day to the bed that actually held them", () => {
    // Twenty minutes in the first bed, the rest of the day in the second.
    const admitted = at("01T10:00:00");
    const end = at("01T18:00:00");
    const [first, second] = splitStayDays(admitted, end, [
      leg("01T10:00:00", "01T10:20:00"), leg("01T10:20:00", null),
    ]);
    expect(first).toBe(0);
    expect(second).toBe(1);
  });
});

describe("splitStayDays - genuine multi-day moves", () => {
  it("splits a three-day stay across a move on day three", () => {
    const admitted = at("01T10:00:00");
    const end = at("04T09:00:00");
    const legs = [leg("01T10:00:00", "03T11:00:00"), leg("03T11:00:00", null)];

    expect(stayDays(admitted, end)).toBe(3);
    expect(splitStayDays(admitted, end, legs)).toEqual([2, 1]);
  });

  it("handles two moves without inventing a day", () => {
    const admitted = at("01T08:00:00");
    const end = at("05T08:00:00");
    const legs = [leg("01T08:00:00", "02T08:00:00"), leg("02T08:00:00", "04T08:00:00"), leg("04T08:00:00", null)];

    expect(stayDays(admitted, end)).toBe(4);
    expect(splitStayDays(admitted, end, legs)).toEqual([1, 2, 1]);
  });
});

describe("splitStayDays - the property that must always hold", () => {
  const cases: [string, string, string, [string, string | null][]][] = [
    ["same-day move", "01T10:00:00", "01T18:00:00", [["01T10:00:00", "01T10:20:00"], ["01T10:20:00", null]]],
    ["move at midnight", "01T00:00:00", "03T00:00:00", [["01T00:00:00", "02T00:00:00"], ["02T00:00:00", null]]],
    ["move seconds before discharge", "01T09:00:00", "03T09:00:00", [["01T09:00:00", "03T08:59:00"], ["03T08:59:00", null]]],
    ["long stay, late move", "01T09:00:00", "10T09:00:00", [["01T09:00:00", "09T09:00:00"], ["09T09:00:00", null]]],
    ["never moved", "01T09:00:00", "04T09:00:00", [["01T09:00:00", null]]],
  ];

  for (const [name, from, to, legSpecs] of cases) {
    it(`${name}: days handed out equal days billed`, () => {
      const legs = legSpecs.map(([f, t]) => leg(f, t));
      expect(conserves(at(from), at(to), legs)).toBe(true);
    });
  }

  it("never hands out a negative day", () => {
    const out = splitStayDays(at("01T09:00:00"), at("03T09:00:00"), [
      leg("01T09:00:00", "01T09:01:00"), leg("01T09:01:00", null),
    ]);
    expect(out.every((n) => n >= 0)).toBe(true);
  });

  it("returns one number per leg, even for a stay with no legs recorded", () => {
    expect(splitStayDays(at("01T09:00:00"), at("02T09:00:00"), [])).toEqual([]);
  });
});

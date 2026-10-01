import { describe, it, expect } from "vitest";
import { billsLimit } from "@/server/services/billing.service";

/**
 * How many bills one list request pulls.
 *
 * The two bill screens used to get the latest hundred (five hundred at most),
 * and a bill older than about a week was simply not on the screen. Owner's rule
 * (1 Oct 2026): no limits - every bill comes back unless a request asks for
 * fewer. `undefined` is Prisma's "no take", i.e. everything.
 */
describe("how many bills one list request may pull", () => {
  it("fetches every bill when nothing is asked for", () => {
    expect(billsLimit(null)).toBeUndefined();
    expect(billsLimit(undefined)).toBeUndefined();
    expect(billsLimit("")).toBeUndefined();
  });

  it("has no ceiling on a number that is asked for", () => {
    expect(billsLimit("250")).toBe(250);
    expect(billsLimit("99999999")).toBe(99999999);
  });

  it("treats junk as 'everything' rather than as an empty screen", () => {
    expect(billsLimit("abc")).toBeUndefined();
    expect(billsLimit("0")).toBeUndefined();
    expect(billsLimit("-40")).toBeUndefined();
    expect(billsLimit("NaN")).toBeUndefined();
    expect(billsLimit("Infinity")).toBeUndefined();
  });

  it("rounds a fractional count down", () => {
    expect(billsLimit("120.9")).toBe(120);
  });
});

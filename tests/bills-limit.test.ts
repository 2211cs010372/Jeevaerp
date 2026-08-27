import { describe, it, expect } from "vitest";
import { billsLimit, BILLS_PAGE, BILLS_PAGE_MAX } from "@/server/services/billing.service";

/**
 * The page size the two bill screens ask for, and the ceiling they cannot ask
 * past.
 *
 * This parameter exists because "All bills" was not all bills. The desk's list
 * is capped at the working queue - a hundred rows, which in this hospital is
 * about a week - and the tab promising every bill was showing that same week.
 * A fortnight-old receipt was simply absent from the screen the desk had been
 * told held all of them, with nothing on the page to say so.
 *
 * The half of that which is testable without a browser is this: what a query
 * string is allowed to turn into. It comes off the URL, so it is untrusted
 * input on a route that reads the invoice table.
 */
describe("how many bills one list request may pull", () => {
  it("gives the working queue when nothing is asked for", () => {
    // The ordinary load, which is nearly every load of these screens.
    expect(billsLimit(null)).toBe(BILLS_PAGE);
    expect(billsLimit(undefined)).toBe(BILLS_PAGE);
    expect(billsLimit("")).toBe(BILLS_PAGE);
  });

  it("gives the wide window the All bills tab asks for", () => {
    expect(billsLimit("500")).toBe(BILLS_PAGE_MAX);
    expect(billsLimit("250")).toBe(250);
  });

  it("clamps at the ceiling, however big the number in the URL", () => {
    // Without this, one typed URL reads the whole invoice table into memory.
    expect(billsLimit("501")).toBe(BILLS_PAGE_MAX);
    expect(billsLimit("99999999")).toBe(BILLS_PAGE_MAX);
    expect(billsLimit(String(Number.MAX_SAFE_INTEGER))).toBe(BILLS_PAGE_MAX);
  });

  it("falls back to the working queue on junk, never to an empty screen", () => {
    // A desk staring at "no bills" because someone fat-fingered the address bar
    // is worse than a desk staring at its usual hundred.
    expect(billsLimit("abc")).toBe(BILLS_PAGE);
    expect(billsLimit("0")).toBe(BILLS_PAGE);
    expect(billsLimit("-40")).toBe(BILLS_PAGE);
    expect(billsLimit("NaN")).toBe(BILLS_PAGE);
    expect(billsLimit("Infinity")).toBe(BILLS_PAGE);
  });

  it("takes the whole number of a fractional limit", () => {
    expect(billsLimit("120.9")).toBe(120);
    // Floors below one, so it is the junk path rather than a zero-row screen.
    expect(billsLimit("0.5")).toBe(BILLS_PAGE);
  });
});

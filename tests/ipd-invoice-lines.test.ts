import { describe, it, expect, vi } from "vitest";

/**
 * WHAT AN IPD BILL IS MADE OF - and the fact that it is made the SAME way twice.
 *
 * Discharge builds these lines to raise the invoice. A charge corrected after
 * discharge rebuilds them to re-issue that same invoice. Before they shared a
 * function they were two copies of the same arithmetic, and two copies drift -
 * the failure being a claim bill and a tax invoice that describe one stay
 * differently, found by a TPA months later with no way to say which was right.
 *
 * The service reaches Prisma at import time, so the client is stubbed. Nothing
 * here touches a database: the function under test is given plain rows and
 * returns plain lines.
 */

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const { buildIpdInvoiceLines } = await import("@/server/services/ipd.service");

const d = (s: string) => new Date(`${s}T12:00:00`);

const charge = (description: string, qty: number, unitPrice: number, gstRatePct = 0) => ({
  description, qty, category: "PROCEDURE",
  unitPrice: { toString: () => unitPrice.toFixed(2) },
  gstRatePct: { toString: () => gstRatePct.toFixed(2) },
});

const stay = (wardName: string, bedNo: string, dailyCharge: number, from: string, to: string | null, gst = 0) => ({
  wardName,
  dailyCharge: { toString: () => dailyCharge.toFixed(2) },
  gstRatePct: { toString: () => gst.toFixed(2) },
  fromDate: d(from), toDate: to ? d(to) : null,
  bed: { bedNo },
});

const admission = (over: Partial<Parameters<typeof buildIpdInvoiceLines>[0]> = {}) => ({
  ipNumber: "JMH2026IP0007",
  admittedAt: d("2026-08-01"),
  dischargedAt: d("2026-08-05"),
  wardNameAtAdmit: "General Ward",
  dailyChargeAtAdmit: { toString: () => "1500.00" },
  gstRatePctAtAdmit: { toString: () => "0.00" },
  bed: { bedNo: "GW-04" },
  charges: [],
  ...over,
});

describe("an IPD bill is the bed, the nursing and the running tab", () => {
  it("prices each bed stay at the rate that ward carried at the time", () => {
    // Moved from a general bed to ICU mid-stay. Two rates, two lines.
    const lines = buildIpdInvoiceLines(admission(), [
      stay("General Ward", "GW-04", 1500, "2026-08-01", "2026-08-03"),
      stay("ICU", "ICU-02", 8000, "2026-08-03", "2026-08-05"),
    ]);
    const beds = lines.filter((l) => l.description.startsWith("Bed ·"));
    expect(beds).toHaveLength(2);
    expect(beds[0].unitPrice).toBe(1500);
    expect(beds[1].unitPrice).toBe(8000);
    // The ICU line must not say "ICU · ICU-02" - see lib/beds.
    expect(beds[1].description).toContain("ICU BED 2");
  });

  it("always bills nursing, once, across the whole stay", () => {
    const lines = buildIpdInvoiceLines(admission(), [stay("General Ward", "GW-04", 1500, "2026-08-01", null)]);
    const nursing = lines.filter((l) => l.description.startsWith("Nursing care"));
    expect(nursing).toHaveLength(1);
    expect(nursing[0].qty).toBe(4);
    expect(nursing[0].gstRatePct).toBe(0);
  });

  it("carries every running-tab line through at ITS OWN gst rate", () => {
    // A ₹5,500 room and a 12% syrup are not taxed the same way.
    const lines = buildIpdInvoiceLines(
      admission({ charges: [charge("Dressing", 2, 250), charge("Syrup", 1, 120, 12)] }),
      [stay("General Ward", "GW-04", 1500, "2026-08-01", null)],
    );
    expect(lines).toContainEqual({ description: "Dressing", qty: 2, unitPrice: 250, gstRatePct: 0 });
    expect(lines).toContainEqual({ description: "Syrup", qty: 1, unitPrice: 120, gstRatePct: 12 });
  });

  it("never bills zero bed-days for a stay with no BedStay rows", () => {
    // Legacy admissions predate BedStay. Falling through to nothing would hand
    // the patient a bill with no bed on it at all.
    const lines = buildIpdInvoiceLines(admission(), []);
    const bed = lines.find((l) => l.description.startsWith("Bed charges ·"));
    expect(bed).toBeDefined();
    expect(bed!.qty).toBe(4);
    expect(bed!.unitPrice).toBe(1500);
  });

  it("survives a freed bed on the fallback path rather than throwing", () => {
    // After discharge the bed may no longer be readable. A closed stay being
    // re-issued must still produce a bill.
    const lines = buildIpdInvoiceLines(admission({ bed: null }), []);
    expect(lines[0].description).toContain("bed not recorded");
  });

  it("rebuilds IDENTICALLY for the same stay - this is the anti-drift property", () => {
    // Discharge builds it once; a post-discharge correction builds it again.
    // The two must be the same object, or the claim bill and the invoice part
    // company.
    const adm = admission({ charges: [charge("Dressing", 2, 250), charge("Oxygen", 3, 400, 5)] });
    const stays = [stay("General Ward", "GW-04", 1500, "2026-08-01", null)];
    expect(buildIpdInvoiceLines(adm, stays)).toEqual(buildIpdInvoiceLines(adm, stays));
  });

  it("moves the total when a charge is corrected, and only by that charge", () => {
    const stays = [stay("General Ward", "GW-04", 1500, "2026-08-01", null)];
    const sum = (ls: { qty: number; unitPrice: number }[]) =>
      ls.reduce((t, l) => t + l.qty * l.unitPrice, 0);

    const before = buildIpdInvoiceLines(admission({ charges: [charge("Dressing", 2, 250)] }), stays);
    // The insurance desk reprices the dressing to the policy's tariff.
    const after = buildIpdInvoiceLines(admission({ charges: [charge("Dressing", 2, 180)] }), stays);
    expect(sum(after)).toBe(sum(before) - 140);
  });
});

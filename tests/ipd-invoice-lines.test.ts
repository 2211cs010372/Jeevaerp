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

const { buildIpdInvoiceLines, hasNursingLine, isNursingLine, billedLegDays, uncoveredStayDays } =
  await import("@/server/services/ipd.service");

const d = (s: string) => new Date(`${s}T12:00:00`);

const charge = (description: string, qty: number, unitPrice: number, gstRatePct = 0) => ({
  description, qty, category: "PROCEDURE",
  unitPrice: { toString: () => unitPrice.toFixed(2) },
  gstRatePct: { toString: () => gstRatePct.toFixed(2) },
});

const stay = (
  wardName: string, bedNo: string, dailyCharge: number,
  from: string, to: string | null, gst = 0,
  billedDays: number | null = null,
) => ({
  wardName,
  dailyCharge: { toString: () => dailyCharge.toFixed(2) },
  gstRatePct: { toString: () => gst.toFixed(2) },
  fromDate: d(from), toDate: to ? d(to) : null,
  bed: { bedNo },
  // Null on almost every call - the bed bills the nights the dates give it.
  billedDays,
});

const admission = (over: Partial<Parameters<typeof buildIpdInvoiceLines>[0]> = {}) => ({
  ipNumber: "JMH2026IP0007",
  admittedAt: d("2026-08-01"),
  dischargedAt: d("2026-08-05"),
  wardNameAtAdmit: "General Ward",
  dailyChargeAtAdmit: { toString: () => "1500.00" },
  gstRatePctAtAdmit: { toString: () => "0.00" },
  // Null = nobody has corrected this stay's nursing rate, so it bills the
  // hospital's standard fee. Spelled out rather than left off: the field is
  // REQUIRED on the input type on purpose, so a caller that forgets to select
  // the column cannot silently bill the default over somebody's correction.
  nursePerDay: null,
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

  it("bills NO nursing on a bill being raised - the fee is withdrawn", () => {
    // The per-day nursing fee was withdrawn as a service. Discharge calls this
    // without asking for nursing, and this is the assertion that a stay
    // admitted today is not quietly charged ₹600 a night for it.
    const lines = buildIpdInvoiceLines(admission(), [stay("General Ward", "GW-04", 1500, "2026-08-01", null)]);
    expect(lines.filter(isNursingLine)).toHaveLength(0);
  });

  it("bills nursing, once, when re-issuing a bill that already had it", () => {
    // A stay billed BEFORE the withdrawal. Its invoice carries a nursing line,
    // and a correction to some other charge re-issues that invoice - which must
    // come back with the nursing still on it. Dropping it here would take ₹600
    // a night off a document the family has already paid against.
    const lines = buildIpdInvoiceLines(
      admission(),
      [stay("General Ward", "GW-04", 1500, "2026-08-01", null)],
      { nursing: true },
    );
    const nursing = lines.filter(isNursingLine);
    expect(nursing).toHaveLength(1);
    expect(nursing[0].qty).toBe(4);
    expect(nursing[0].unitPrice).toBe(600);
    expect(nursing[0].gstRatePct).toBe(0);
  });

  it("re-issues nursing at the STAY'S rate once a desk has corrected it", () => {
    // An insurer settling nursing at its own tariff. The correction lives on
    // the stay, so the re-issued invoice has to carry it - a bill that quietly
    // reverted to ₹600 is exactly the disagreement between the claim bill and
    // the tax invoice this whole shared function exists to prevent.
    const lines = buildIpdInvoiceLines(
      admission({ nursePerDay: { toString: () => "450.00" } }),
      [stay("General Ward", "GW-04", 1500, "2026-08-01", null)],
      { nursing: true },
    );
    const nursing = lines.find(isNursingLine)!;
    expect(nursing.unitPrice).toBe(450);
    expect(nursing.qty).toBe(4);
    expect(nursing.description).toContain("₹450");
  });

  it("keeps a WAIVED nursing line on the re-issue rather than dropping it", () => {
    // ₹0 is a real answer and must not fall back to the hospital's rate the way
    // null does. Waiving nursing on a long stay was an ordinary concession, and
    // the desk's old workaround was a negative line on the tab.
    //
    // The line still prints, at ₹0. That is the whole difference between a stay
    // whose nursing was WAIVED and one admitted after the fee was WITHDRAWN:
    // the waived stay shows the concession on its bill, and the withdrawn one
    // has no nursing to show at all.
    const lines = buildIpdInvoiceLines(
      admission({ nursePerDay: { toString: () => "0.00" } }),
      [stay("General Ward", "GW-04", 1500, "2026-08-01", null)],
      { nursing: true },
    );
    const nursing = lines.find(isNursingLine)!;
    expect(nursing.unitPrice).toBe(0);
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
    // And for a stay old enough to still carry nursing, which builds down the
    // other branch entirely.
    expect(buildIpdInvoiceLines(adm, stays, { nursing: true }))
      .toEqual(buildIpdInvoiceLines(adm, stays, { nursing: true }));
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

/**
 * WHICH STAYS STILL CARRY NURSING - asked of the stay's own invoice, never of a
 * cutover date. A date would have to be recorded somewhere and would be wrong
 * for any stay that straddled it. The invoice cannot be wrong: a stay was
 * billed for nursing if and only if its IPD bill says so.
 */
describe("a stay carries nursing only if its own invoice already did", () => {
  const inv = (source: string, ...descriptions: string[]) => ({
    source,
    items: descriptions.map((description) => ({ description })),
  });
  const BED = "Bed · General Ward BED 4 · 4 days";

  it("says yes for a stay whose IPD bill has the line", () => {
    expect(hasNursingLine([inv("IPD", BED, "Nursing care · 4 day(s) × ₹600")])).toBe(true);
  });

  it("says no for a stay billed since the fee was withdrawn", () => {
    expect(hasNursingLine([inv("IPD", BED, "Dressing")])).toBe(false);
  });

  it("says no for a stay still running, which has no invoice at all", () => {
    expect(hasNursingLine([])).toBe(false);
  });

  it("ignores the pharmacy's and the lab's own invoices", () => {
    // Those are separate documents raised against the same stay. Whether the
    // STAY was billed for nursing is only ever answered by the IPD bill.
    expect(hasNursingLine([inv("PHARMACY", "Nursing care · 4 day(s) × ₹600")])).toBe(false);
  });

  it("still recognises a waived line, which reads ₹0 and is still a line", () => {
    expect(isNursingLine({ description: "Nursing care · 4 day(s) × ₹0" })).toBe(true);
  });

  it("does not mistake a hand-typed ward charge for the derived fee", () => {
    // "night nursing" is the placeholder the add-charge box suggests. A desk
    // that types one is raising an ordinary tab line, not reinstating the fee.
    expect(isNursingLine({ description: "Night nursing attendant" })).toBe(false);
  });
});

/**
 * CAPPING A BED - billing it for fewer days than the patient lay in it.
 *
 * The case it exists for: a long stay where the first few days are billed as a
 * bed and the rest is raised as its own line, because it is a package, a
 * procedure, or a rate the insurer settles separately. The desk's workaround
 * was a negative "adjustment" on the tab, which on a claim reads as the
 * hospital correcting its own bill.
 *
 * The property that matters most is the one at the bottom: a cap takes nights
 * OFF the bill and puts them nowhere. Something has to count them.
 */
describe("a bed leg can be billed for fewer days than it held", () => {
  const legs = (...over: (number | null)[]) => [
    { fromDate: d("2026-08-17"), toDate: d("2026-08-21"), billedDays: over[0] ?? null },
  ];
  const from = d("2026-08-17");
  const until = d("2026-08-25");

  it("bills the nights the dates give it when nothing is capped", () => {
    expect(billedLegDays(from, until, legs(null))).toEqual([8]);
    expect(uncoveredStayDays(from, until, legs(null))).toBe(0);
  });

  it("bills exactly the capped number instead", () => {
    // Admitted 17/08, 8 nights on the ward, but only 3 billed as a bed.
    expect(billedLegDays(from, until, legs(3))).toEqual([3]);
  });

  it("counts the nights the cap took off, so they cannot vanish quietly", () => {
    // THE WHOLE POINT. A cap does not move those five nights anywhere - the
    // desk is expected to raise them as their own charge, and this is the
    // number every screen shows them so they remember to.
    expect(uncoveredStayDays(from, until, legs(3))).toBe(5);
  });

  it("treats a cap of 0 as a real answer, not as 'not capped'", () => {
    // A ward billed entirely as a package. Falling back to the dates here would
    // put the whole stay back on the bill under a line nobody meant to raise.
    expect(billedLegDays(from, until, legs(0))).toEqual([0]);
    expect(uncoveredStayDays(from, until, legs(0))).toBe(8);
  });

  it("floors a negative cap rather than subtracting a night from the bill", () => {
    expect(billedLegDays(from, until, legs(-3))).toEqual([0]);
  });

  it("caps ONE leg of a transfer and leaves the other on its dates", () => {
    const transferred = [
      { fromDate: d("2026-08-17"), toDate: d("2026-08-20"), billedDays: 1 },
      { fromDate: d("2026-08-20"), toDate: null, billedDays: null },
    ];
    // The split gives 3 and 5; the first leg is capped to 1, the second is not.
    expect(billedLegDays(from, until, transferred)).toEqual([1, 5]);
    expect(uncoveredStayDays(from, until, transferred)).toBe(2);
  });

  it("puts the cap on the INVOICE line, qty and description together", () => {
    // The description is what a family reads on the bill. A line saying "5 days"
    // beside a qty of 3 is the disagreement this whole path has to avoid.
    const lines = buildIpdInvoiceLines(
      admission({ admittedAt: d("2026-08-17"), dischargedAt: d("2026-08-25") }),
      [stay("General Ward", "GW-04", 1500, "2026-08-17", null, 0, 3)],
    );
    const bed = lines.find((l) => l.description.startsWith("Bed ·"))!;
    expect(bed.qty).toBe(3);
    expect(bed.description).toContain("3 days");
    expect(bed.qty * bed.unitPrice).toBe(4500);
  });

  it("leaves an uncapped bill exactly as it was - this is the no-op property", () => {
    // Every existing row has billedDays null. If this ever stops matching, the
    // column has quietly re-priced every stay in the hospital.
    const uncapped = buildIpdInvoiceLines(
      admission({ admittedAt: d("2026-08-17"), dischargedAt: d("2026-08-25") }),
      [stay("General Ward", "GW-04", 1500, "2026-08-17", null)],
    );
    const bed = uncapped.find((l) => l.description.startsWith("Bed ·"))!;
    expect(bed.qty).toBe(8);
  });
});

import { describe, expect, it } from "vitest";
import {
  buildTallyXml,
  escapeXml,
  isBalanced,
  tallyFilename,
  toTallyDate,
  TallyImbalanceError,
  type TallyVoucher,
} from "@/lib/export/tally-xml";

/**
 * The stakes here are different from most of this codebase. A bug in a screen
 * shows up as a wrong screen; a bug here lands in the hospital's actual books
 * and is discovered by an auditor months later. So the balance rule is tested
 * hardest - Tally accepts unbalanced vouchers and silently carries the
 * difference, which is the failure mode that hides.
 */

const sale = (over: Partial<TallyVoucher> = {}): TallyVoucher => ({
  type: "Sales",
  date: "20260728",
  voucherNo: "JMH20261042",
  partyName: "Ravi Kumar",
  narration: "PHARMACY - JMH2026OP00001",
  entries: [
    { ledger: "Sundry Debtors", amount: -56 },
    { ledger: "Pharmacy Sales", amount: 50 },
    { ledger: "Output CGST", amount: 3 },
    { ledger: "Output SGST", amount: 3 },
  ],
  ...over,
});

const wrap = (vouchers: TallyVoucher[]) =>
  buildTallyXml({ companyName: "Jeeva Hospital", from: "2026-07-01", to: "2026-07-31", vouchers });

describe("balance", () => {
  it("accepts a voucher whose debits and credits cancel", () => {
    expect(isBalanced(sale())).toBe(true);
  });

  it("rejects one that doesn't", () => {
    expect(isBalanced(sale({ entries: [{ ledger: "Cash", amount: -56 }, { ledger: "Sales", amount: 50 }] }))).toBe(false);
  });

  it("tolerates sub-paisa float drift from percentage-derived tax", () => {
    // 18% of 33.33 computed in floating point does not land exactly. That is
    // arithmetic, not a defect, and must not block an export.
    const v = sale({ entries: [
      { ledger: "Sundry Debtors", amount: -39.33 },
      { ledger: "Pharmacy Sales", amount: 33.33 },
      { ledger: "Output CGST", amount: 3.0 },
      { ledger: "Output SGST", amount: 2.999999 },
    ] });
    expect(isBalanced(v)).toBe(true);
  });

  it("refuses to export the whole file when any voucher is out", () => {
    // Deliberately all-or-nothing: a partial export is worse than none, because
    // the CA cannot tell which vouchers were dropped.
    expect(() => wrap([sale(), sale({ voucherNo: "BAD-1", entries: [{ ledger: "Cash", amount: -10 }] })]))
      .toThrow(TallyImbalanceError);
  });

  it("names the offending voucher and the amount it is out by", () => {
    try {
      wrap([sale({ voucherNo: "BAD-1", entries: [{ ledger: "Cash", amount: -10 }, { ledger: "Sales", amount: 7 }] })]);
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(TallyImbalanceError);
      expect((e as TallyImbalanceError).voucherNo).toBe("BAD-1");
      expect((e as Error).message).toContain("-3.00");
    }
  });
});

describe("Tally sign convention", () => {
  it("marks debits as deemed-positive and credits as not", () => {
    // Tally's convention is the inverse of intuition: AMOUNT is negative for a
    // debit, and ISDEEMEDPOSITIVE is Yes on exactly those lines.
    const xml = wrap([sale()]);
    const debtor = xml.slice(xml.indexOf("Sundry Debtors"));
    expect(debtor.slice(0, 200)).toContain("<ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>");
    const sales = xml.slice(xml.indexOf("Pharmacy Sales"));
    expect(sales.slice(0, 200)).toContain("<ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>");
  });

  it("writes amounts to exactly two decimals", () => {
    expect(wrap([sale()])).toContain("<AMOUNT>-56.00</AMOUNT>");
  });

  it("never emits negative zero, which Tally reads as malformed", () => {
    const xml = wrap([sale({ entries: [
      { ledger: "Sundry Debtors", amount: -0.0001 },
      { ledger: "Pharmacy Sales", amount: 0.0001 },
    ] })]);
    expect(xml).not.toContain("-0.00");
    expect(xml).toContain("<AMOUNT>0.00</AMOUNT>");
  });
});

describe("XML safety", () => {
  it("escapes the five XML metacharacters", () => {
    expect(escapeXml(`Tom & "Jerry" <b>'x'</b>`))
      .toBe("Tom &amp; &quot;Jerry&quot; &lt;b&gt;&apos;x&apos;&lt;/b&gt;");
  });

  it("escapes a party name rather than letting it break the document", () => {
    // "Sons & Co" is an ordinary Indian company name and a raw & is invalid XML.
    const xml = wrap([sale({ partyName: "Reddy & Sons <Pvt>" })]);
    expect(xml).toContain("Reddy &amp; Sons &lt;Pvt&gt;");
    expect(xml).not.toContain("Reddy & Sons");
  });

  it("escapes the company name too", () => {
    const xml = buildTallyXml({ companyName: "A & B Hospital", from: "2026-07-01", to: "2026-07-01", vouchers: [] });
    expect(xml).toContain("<SVCURRENTCOMPANY>A &amp; B Hospital</SVCURRENTCOMPANY>");
  });
});

describe("document shape", () => {
  it("wraps vouchers in the import envelope Tally expects", () => {
    const xml = wrap([sale()]);
    expect(xml).toContain("<TALLYREQUEST>Import Data</TALLYREQUEST>");
    expect(xml).toContain("<REPORTNAME>Vouchers</REPORTNAME>");
    expect(xml).toContain('<VOUCHER VCHTYPE="Sales" ACTION="Create"');
    expect(xml).toContain("<VOUCHERNUMBER>JMH20261042</VOUCHERNUMBER>");
  });

  it("emits a valid empty document when nothing was billed", () => {
    const xml = buildTallyXml({ companyName: "Jeeva", from: "2026-07-01", to: "2026-07-01", vouchers: [] });
    expect(xml).toContain("<REQUESTDATA>");
    expect(xml).not.toContain("<VOUCHER ");
  });

  it("carries all three voucher types", () => {
    const xml = wrap([
      sale(),
      sale({ type: "Receipt", voucherNo: "JMH20261042-R1", entries: [{ ledger: "Cash", amount: -56 }, { ledger: "Sundry Debtors", amount: 56 }] }),
      sale({ type: "Credit Note", voucherNo: "JMH20261042-CN1", entries: [{ ledger: "Pharmacy Sales", amount: -56 }, { ledger: "Cash", amount: 56 }] }),
    ]);
    expect(xml).toContain('VCHTYPE="Sales"');
    expect(xml).toContain('VCHTYPE="Receipt"');
    expect(xml).toContain('VCHTYPE="Credit Note"');
  });

  it("omits the narration element when there is no narration", () => {
    const xml = wrap([sale({ narration: undefined })]);
    expect(xml).not.toContain("<NARRATION>");
  });
});

describe("dates and filenames", () => {
  it("converts ISO dates to Tally's YYYYMMDD", () => {
    expect(toTallyDate("2026-07-28")).toBe("20260728");
  });

  it("names a single-day file by that day", () => {
    expect(tallyFilename("2026-07-28", "2026-07-28")).toBe("jeeva-tally-2026-07-28.xml");
  });

  it("names a range file by both ends", () => {
    expect(tallyFilename("2026-07-01", "2026-07-31")).toBe("jeeva-tally-2026-07-01_to_2026-07-31.xml");
  });
});

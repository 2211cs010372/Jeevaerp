import { describe, expect, it } from "vitest";
import {
  buildEInvoicePayload,
  checkEligibility,
  isValidDocNo,
  isValidGstin,
  isValidGstinChecksum,
  stateCodeOfGstin,
  toIrpDate,
  EInvoiceIneligibleError,
  type EInvoiceBuyer,
  type EInvoiceSeller,
  type EInvoiceSourceDoc,
} from "@/lib/gst/einvoice-payload";

/**
 * These rules are the government's, and the cost of getting one wrong is not a
 * crash - it is a rejected invoice that has to be cancelled and reissued under a
 * new number. Every check the portal makes that we can make first is pinned here.
 */

/**
 * An externally-published GSTIN, used as the anchor for the checksum algorithm.
 * Without at least one value whose check digit we did NOT compute ourselves,
 * every other GSTIN assertion here would only prove the implementation agrees
 * with itself.
 */
const KNOWN_GOOD_GSTIN = "27AAPFU0939F1ZV";

// Telangana (36) GSTINs with valid check digits, for the seller and buyer.
const SELLER_GSTIN = "36AABCU9603R1ZO";
const BUYER_GSTIN = "36AAACS8577K1ZQ";

const seller: EInvoiceSeller = {
  gstin: SELLER_GSTIN,
  legalName: "Jeeva Multispeciality Hospital",
  addressLine: "Plot 12, Hanamkonda",
  city: "Warangal",
  stateCode: "36",
  pincode: "506001",
  phone: "+919848012345",
  email: "billing@jeeva.example",
};

const buyer: EInvoiceBuyer = {
  gstin: BUYER_GSTIN,
  legalName: "Star Health Insurance Ltd",
  address: "1 Insurance Road",
  stateCode: "36",
};

const doc = (over: Partial<EInvoiceSourceDoc> = {}): EInvoiceSourceDoc => ({
  receiptNo: "JMH2026-1042",
  invoiceDate: new Date("2026-07-28T10:30:00"),
  lines: [
    { description: "Paracetamol 500mg", hsnSac: "30049099", qty: 10, unitPrice: 5, amount: 50, gstRatePct: 12, isService: false },
  ],
  discountAmount: 0,
  taxableAmount: 50,
  cgstAmount: 3,
  sgstAmount: 3,
  totalAmount: 56,
  ...over,
});

describe("GSTIN validation", () => {
  it("validates a GSTIN published outside this codebase", () => {
    // The anchor. If the algorithm ever drifts, this is the assertion that
    // catches it - the others use check digits derived from the same code.
    expect(isValidGstin(KNOWN_GOOD_GSTIN)).toBe(true);
    expect(isValidGstinChecksum(KNOWN_GOOD_GSTIN)).toBe(true);
  });

  it("accepts a well-formed GSTIN with a correct check digit", () => {
    expect(isValidGstin(SELLER_GSTIN)).toBe(true);
    expect(isValidGstin(BUYER_GSTIN)).toBe(true);
  });

  it("rejects a GSTIN whose check digit is wrong", () => {
    // Same 14 characters, last one altered - this is exactly what a typo looks
    // like, and the shape regex alone would wave it through.
    const bad = SELLER_GSTIN.slice(0, 14) + (SELLER_GSTIN[14] === "A" ? "B" : "A");
    expect(isValidGstinChecksum(bad)).toBe(false);
    expect(isValidGstin(bad)).toBe(false);
  });

  it("rejects wrong length, empty and null", () => {
    expect(isValidGstin("36AABCU9603R1Z")).toBe(false);
    expect(isValidGstin("")).toBe(false);
    expect(isValidGstin(null)).toBe(false);
    expect(isValidGstin(undefined)).toBe(false);
  });

  it("reads the state code off the front of a GSTIN", () => {
    expect(stateCodeOfGstin(SELLER_GSTIN)).toBe("36");
  });
});

describe("portal formatting rules", () => {
  it("writes dates as DD/MM/YYYY, not ISO", () => {
    expect(toIrpDate(new Date("2026-07-05T00:00:00"))).toBe("05/07/2026");
    expect(toIrpDate(new Date("2026-12-31T23:59:00"))).toBe("31/12/2026");
  });

  it("accepts document numbers the portal allows", () => {
    expect(isValidDocNo("JMH2026-1042")).toBe(true);
    expect(isValidDocNo("INV/2026/01")).toBe(true);
  });

  it("rejects document numbers the portal refuses", () => {
    expect(isValidDocNo("0JMH1042")).toBe(false);      // leading zero
    expect(isValidDocNo("/JMH1042")).toBe(false);      // leading slash
    expect(isValidDocNo("-JMH1042")).toBe(false);      // leading hyphen
    expect(isValidDocNo("A".repeat(17))).toBe(false);  // over 16 characters
    expect(isValidDocNo("JMH#1042")).toBe(false);      // disallowed character
  });
});

describe("eligibility", () => {
  it("passes a well-formed B2B bill", () => {
    expect(checkEligibility(doc(), seller, buyer)).toEqual({ eligible: true, reasons: [] });
  });

  it("treats a bill with no buyer as B2C and therefore out of scope", () => {
    const r = checkEligibility(doc(), seller, null);
    expect(r.eligible).toBe(false);
    expect(r.reasons.join(" ")).toContain("B2C");
  });

  it("reports every problem at once, not just the first", () => {
    // A clerk fixing a bill should get one list, not five rounds of one error.
    const r = checkEligibility(
      doc({ receiptNo: "0bad", totalAmount: 0, lines: [] }),
      { ...seller, gstin: "nonsense" },
      { ...buyer, gstin: "alsononsense", legalName: "" }
    );
    expect(r.eligible).toBe(false);
    expect(r.reasons.length).toBeGreaterThanOrEqual(4);
  });

  it("catches a GST rate the portal doesn't recognise", () => {
    const r = checkEligibility(doc({ lines: [{ ...doc().lines[0], gstRatePct: 1.8 }] }), seller, buyer);
    expect(r.reasons.join(" ")).toContain("1.8%");
  });

  it("catches a taxed line with no HSN/SAC", () => {
    const r = checkEligibility(doc({ lines: [{ ...doc().lines[0], hsnSac: null }] }), seller, buyer);
    expect(r.reasons.join(" ")).toContain("no HSN/SAC");
  });

  it("allows an exempt line with no HSN/SAC", () => {
    // Healthcare services are exempt and carry no HSN. Demanding one here would
    // block the ordinary case.
    const r = checkEligibility(
      doc({
        lines: [{ description: "Consultation", hsnSac: null, qty: 1, unitPrice: 500, amount: 500, gstRatePct: 0, isService: true }],
        taxableAmount: 500, cgstAmount: 0, sgstAmount: 0, totalAmount: 500,
      }),
      seller, buyer
    );
    expect(r.eligible).toBe(true);
  });

  it("catches a buyer state code that contradicts their GSTIN", () => {
    const r = checkEligibility(doc(), seller, { ...buyer, stateCode: "29" });
    expect(r.reasons.join(" ")).toContain("state code");
  });
});

describe("payload", () => {
  it("builds the NIC v1.1 envelope", () => {
    const p = buildEInvoicePayload(doc(), seller, buyer);
    expect(p.Version).toBe("1.1");
    expect(p.TranDtls.SupTyp).toBe("B2B");
    expect(p.DocDtls).toEqual({ Typ: "INV", No: "JMH2026-1042", Dt: "28/07/2026" });
    expect(p.SellerDtls.Gstin).toBe(SELLER_GSTIN);
    expect(p.BuyerDtls.Gstin).toBe(BUYER_GSTIN);
  });

  it("splits GST evenly into CGST and SGST and reports no IGST", () => {
    // A hospital's supply is intra-state by place-of-supply rules; see the note
    // at the top of einvoice-payload.ts.
    const item = buildEInvoicePayload(doc(), seller, buyer).ItemList[0];
    expect(item.CgstAmt).toBe(3);
    expect(item.SgstAmt).toBe(3);
    expect(item.IgstAmt).toBe(0);
    expect(item.TotItemVal).toBe(56);
  });

  it("puts place of supply in the seller's state", () => {
    expect(buildEInvoicePayload(doc(), seller, buyer).BuyerDtls.Pos).toBe("36");
  });

  it("marks services and goods differently", () => {
    const svc = buildEInvoicePayload(
      doc({ lines: [{ description: "CBP", hsnSac: null, qty: 1, unitPrice: 300, amount: 300, gstRatePct: 0, isService: true }], taxableAmount: 300, cgstAmount: 0, sgstAmount: 0, totalAmount: 300 }),
      seller, buyer
    );
    expect(svc.ItemList[0].IsServc).toBe("Y");
    expect(svc.ItemList[0].Unit).toBe("OTH");
    expect(buildEInvoicePayload(doc(), seller, buyer).ItemList[0].IsServc).toBe("N");
  });

  it("carries the invoice totals into ValDtls", () => {
    const v = buildEInvoicePayload(doc({ discountAmount: 10 }), seller, buyer).ValDtls;
    expect(v).toMatchObject({ AssVal: 50, CgstVal: 3, SgstVal: 3, IgstVal: 0, Discount: 10, TotInvVal: 56 });
  });

  it("rounds money to two decimals rather than emitting float noise", () => {
    const p = buildEInvoicePayload(
      doc({ lines: [{ description: "Syrup", hsnSac: "30049099", qty: 3, unitPrice: 33.33, amount: 99.99, gstRatePct: 5, isService: false }], taxableAmount: 99.99, cgstAmount: 2.5, sgstAmount: 2.5, totalAmount: 104.99 }),
      seller, buyer
    );
    expect(p.ItemList[0].CgstAmt).toBe(2.5);
    expect(String(p.ItemList[0].TotItemVal)).not.toMatch(/\d{4,}$/);
  });

  it("refuses to build a payload for an ineligible bill", () => {
    // There is nothing useful to do with an invalid e-invoice except not send
    // it, and a payload that exists is one something will eventually POST.
    expect(() => buildEInvoicePayload(doc(), seller, { ...buyer, gstin: "rubbish" }))
      .toThrow(EInvoiceIneligibleError);
  });
});

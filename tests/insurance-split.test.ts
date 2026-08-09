import { describe, it, expect } from "vitest";
import { approvalOf, splitStay, type ClaimLike } from "@/lib/insurance-split";

/**
 * The cases below are the ones a hospital actually hits, in the order they hurt:
 * a family charged for a stay they were promised was cashless, and a family sent
 * home owing ₹70,000 nobody asked them for.
 */

const claim = (o: Partial<ClaimLike>): ClaimLike => ({
  stage: "FINAL",
  status: "APPROVED",
  claimedAmount: "250000",
  approvedAmount: "180000",
  settledAmount: null,
  claimNo: "CLM-2026-000001",
  ...o,
});

const split = (o: Partial<Parameters<typeof splitStay>[0]>) =>
  splitStay({
    billTotal: 250000,
    isInsurance: true,
    approval: approvalOf([claim({})]),
    ...o,
  });

describe("approvalOf", () => {
  it("treats no claim at all as pending, not as approved", () => {
    const a = approvalOf([]);
    expect(a.pending).toBe(true);
    expect(a.decided).toBe(false);
    expect(a.approved).toBe(0);
  });

  it("treats a null claim list as pending", () => {
    expect(approvalOf(null).pending).toBe(true);
    expect(approvalOf(undefined).pending).toBe(true);
  });

  it("does not count a submitted claim as cover - they have agreed nothing", () => {
    const a = approvalOf([claim({ status: "SUBMITTED" })]);
    expect(a.pending).toBe(true);
    expect(a.approved).toBe(0);
    expect(a.claimNo).toBe("CLM-2026-000001");
  });

  it("does not count a queried or draft claim either", () => {
    expect(approvalOf([claim({ status: "QUERIED" })]).pending).toBe(true);
    expect(approvalOf([claim({ status: "DRAFT" })]).pending).toBe(true);
  });

  it("reads a straight approval", () => {
    const a = approvalOf([claim({ status: "APPROVED" })]);
    expect(a.decided).toBe(true);
    expect(a.rejected).toBe(false);
    expect(a.approved).toBe(180000);
  });

  it("reads a part-approval as decided, at the lower figure", () => {
    const a = approvalOf([claim({ status: "PARTIALLY_APPROVED", approvedAmount: "120000" })]);
    expect(a.decided).toBe(true);
    expect(a.approved).toBe(120000);
  });

  it("carries the settled figure separately from the approved one", () => {
    const a = approvalOf([claim({ status: "SETTLED", approvedAmount: "180000", settledAmount: "180000" })]);
    expect(a.approved).toBe(180000);
    expect(a.settled).toBe(180000);
  });

  it("reports a rejection as decided-and-refused, not as pending", () => {
    const a = approvalOf([claim({ status: "REJECTED", approvedAmount: null })]);
    expect(a.decided).toBe(true);
    expect(a.rejected).toBe(true);
    expect(a.approved).toBe(0);
  });

  it("ignores the abandoned ₹0 pre-auth every insurance admission opens", () => {
    const a = approvalOf([
      claim({ stage: "PRE_AUTH", status: "CLOSED", claimedAmount: "0", approvedAmount: null }),
    ]);
    expect(a.pending).toBe(true);
  });

  it("lets the final claim supersede the pre-auth rather than adding to it", () => {
    const a = approvalOf([
      claim({ stage: "PRE_AUTH", status: "APPROVED", approvedAmount: "150000", claimNo: "PRE-1" }),
      claim({ stage: "FINAL", status: "APPROVED", approvedAmount: "180000", claimNo: "FIN-1" }),
    ]);
    expect(a.approved).toBe(180000);
    expect(a.claimNo).toBe("FIN-1");
  });

  it("falls back to a decided pre-auth while the stay is still running", () => {
    const a = approvalOf([claim({ stage: "PRE_AUTH", status: "APPROVED", approvedAmount: "150000" })]);
    expect(a.decided).toBe(true);
    expect(a.approved).toBe(150000);
  });
});

describe("splitStay - the spec's worked example", () => {
  it("₹2,50,000 bill with ₹1,80,000 approved leaves the patient ₹70,000", () => {
    const s = split({});
    expect(s.stayTotal).toBe(250000);
    expect(s.insuranceApproved).toBe(180000);
    expect(s.patientPayable).toBe(70000);
    expect(s.patientDue).toBe(70000);
    expect(s.insuranceReceivable).toBe(180000);
  });

  it("after ₹50,000 is collected the patient still owes ₹20,000, and the insurer still owes ₹1,80,000", () => {
    const s = split({ advance: 50000 });
    expect(s.patientPayable).toBe(70000);
    expect(s.patientDue).toBe(20000);
    // The insurer's side is untouched by what the family paid. This is the
    // whole point: patient money never settles an insurance receivable.
    expect(s.insuranceReceivable).toBe(180000);
  });
});

describe("splitStay - the test cases the spec lists", () => {
  it("1. cash patient without insurance: the whole bill is theirs", () => {
    const s = split({ isInsurance: false, billTotal: 4000, approval: approvalOf([]) });
    expect(s.patientPayable).toBe(4000);
    expect(s.patientDue).toBe(4000);
    expect(s.insuranceApproved).toBe(0);
    expect(s.knowsPatientShare).toBe(true);
  });

  it("2. fully covered bill: the patient pays nothing", () => {
    const s = split({ approval: approvalOf([claim({ approvedAmount: "250000" })]) });
    expect(s.patientPayable).toBe(0);
    expect(s.patientDue).toBe(0);
    expect(s.insuranceReceivable).toBe(250000);
  });

  it("3. insurance + patient payment: both sides are stated separately", () => {
    const s = split({ advance: 70000 });
    expect(s.patientDue).toBe(0);
    expect(s.insuranceReceivable).toBe(180000);
    // Fully paid on the patient's side is NOT fully paid on the bill.
    expect(s.patientPayable).toBe(70000);
  });

  it("4. partial patient payment leaves a patient balance, not an insurance one", () => {
    const s = split({ advance: 40000 });
    expect(s.patientDue).toBe(30000);
    expect(s.insuranceReceivable).toBe(180000);
  });

  it("6. an approval larger than the bill covers it in full and no more", () => {
    const s = split({ billTotal: 100000, approval: approvalOf([claim({ approvedAmount: "180000" })]) });
    expect(s.insuranceApproved).toBe(100000);
    expect(s.patientPayable).toBe(0);
    expect(s.insuranceReceivable).toBe(100000);
  });

  it("7/8. non-covered pharmacy and lab land on the patient's side", () => {
    // ₹2,50,000 stay + ₹8,000 of pharmacy on the claim, ₹1,80,000 approved.
    const s = split({ claimBillsTotal: 8000 });
    expect(s.stayTotal).toBe(258000);
    expect(s.patientPayable).toBe(78000);
  });

  it("9. insurance pending: nothing is assumed, and the screen is told so", () => {
    const s = split({ approval: approvalOf([claim({ status: "SUBMITTED" })]) });
    expect(s.knowsPatientShare).toBe(false);
    expect(s.patientPayable).toBe(0);
    expect(s.refundDue).toBe(0);
  });

  it("9b. a pending claim never reports a refund, however big the deposit", () => {
    const s = split({ advance: 100000, approval: approvalOf([claim({ status: "SUBMITTED" })]) });
    expect(s.refundDue).toBe(0);
    expect(s.knowsPatientShare).toBe(false);
  });

  it("10/12. a part settlement leaves the rest receivable from the insurer", () => {
    const s = split({
      approval: approvalOf([claim({ status: "SETTLED", approvedAmount: "180000", settledAmount: "100000" })]),
    });
    expect(s.insuranceReceivable).toBe(80000);
    // The shortfall is the INSURER's, not the family's. Their share is unmoved.
    expect(s.patientPayable).toBe(70000);
  });

  it("13. a rejection makes the whole stay the patient's", () => {
    const s = split({ approval: approvalOf([claim({ status: "REJECTED", approvedAmount: null })]) });
    expect(s.patientPayable).toBe(250000);
    expect(s.insuranceApproved).toBe(0);
    expect(s.insuranceReceivable).toBe(0);
    expect(s.knowsPatientShare).toBe(true);
  });
});

describe("splitStay - the advance belongs to the family", () => {
  it("a deposit beyond the patient's share is refundable, not the insurer's", () => {
    // ₹1L deposit, ₹70,000 patient share -> ₹30,000 goes back.
    const s = split({ advance: 100000 });
    expect(s.patientDue).toBe(0);
    expect(s.refundDue).toBe(30000);
    // and it must NOT have been spent on the insurer's ₹1,80,000
    expect(s.insuranceReceivable).toBe(180000);
  });

  it("only ever applies as much of the deposit as the share needs", () => {
    const s = split({ advance: 100000 });
    expect(s.advanceApplied).toBe(70000);
  });

  it("a self-pay deposit bigger than the bill is refundable too", () => {
    const s = split({ isInsurance: false, billTotal: 4000, advance: 5000, approval: approvalOf([]) });
    expect(s.refundDue).toBe(1000);
    expect(s.patientDue).toBe(0);
  });
});

describe("splitStay - arithmetic that must not drift", () => {
  it("keeps paise exact rather than accumulating float error", () => {
    const s = split({
      billTotal: 8708.16, claimBillsTotal: 100,
      approval: approvalOf([claim({ approvedAmount: "7200" })]),
    });
    expect(s.stayTotal).toBe(8808.16);
    expect(s.patientPayable).toBe(1608.16);
  });

  it("never reports a negative payable, due or refund", () => {
    const s = split({ billTotal: 1000, advance: 9999, approval: approvalOf([claim({ approvedAmount: "1000" })]) });
    expect(s.patientPayable).toBeGreaterThanOrEqual(0);
    expect(s.patientDue).toBeGreaterThanOrEqual(0);
    expect(s.refundDue).toBeGreaterThanOrEqual(0);
  });

  it("patient payable + insurance approved always accounts for the whole stay", () => {
    for (const approved of ["0", "1", "70000", "180000", "249999.99", "250000"]) {
      const s = split({ approval: approvalOf([claim({ approvedAmount: approved })]) });
      expect(s.patientPayable + s.insuranceApproved).toBeCloseTo(s.stayTotal, 2);
    }
  });
});

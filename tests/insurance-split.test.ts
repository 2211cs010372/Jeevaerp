import { describe, it, expect } from "vitest";
import {
  approvalOf, splitStay, splitInvoice, allocateCoverage, copayOn, type ClaimLike,
} from "@/lib/insurance-split";

/**
 * The scenario these were written against, in the hospital's own words:
 * bill ₹2,00,000, insurer claims ₹1,80,000, the remaining ₹20,000 is the
 * patient's and must show up as a due at reception under their name.
 */
describe("splitInvoice - one bill, two debtors", () => {
  const bill = (o: Partial<Parameters<typeof splitInvoice>[0]> = {}) =>
    splitInvoice({ totalAmount: 200000, insuranceCoveredAmount: 180000, payments: [], ...o });

  it("₹2,00,000 bill with ₹1,80,000 covered leaves the patient ₹20,000", () => {
    const s = bill();
    expect(s.patientPayable).toBe(20000);
    expect(s.patientBalance).toBe(20000);
    expect(s.insuranceReceivable).toBe(180000);
    expect(s.fullySettled).toBe(false);
  });

  it("the insurer settling in full does NOT clear the patient's ₹20,000", () => {
    // The exact bug this column exists to fix: Invoice.status would read PAID
    // here, and the family's share would vanish from every list.
    const s = bill({ payments: [{ mode: "INSURANCE", amount: 180000 }] });
    expect(s.insuranceReceivable).toBe(0);
    expect(s.patientBalance).toBe(20000);
    expect(s.fullySettled).toBe(false);
  });

  it("the patient paying does NOT reduce what the insurer owes", () => {
    const s = bill({ payments: [{ mode: "CASH", amount: 20000 }] });
    expect(s.patientBalance).toBe(0);
    expect(s.insuranceReceivable).toBe(180000);
  });

  it("only both sides paying settles the bill", () => {
    const s = bill({ payments: [{ mode: "INSURANCE", amount: 180000 }, { mode: "UPI", amount: 20000 }] });
    expect(s.fullySettled).toBe(true);
  });

  it("a part payment from the family leaves the rest owed", () => {
    const s = bill({ payments: [{ mode: "CASH", amount: 12000 }] });
    expect(s.patientPaid).toBe(12000);
    expect(s.patientBalance).toBe(8000);
  });

  it("counts every non-INSURANCE mode as the patient's money", () => {
    const s = bill({
      payments: [
        { mode: "CASH", amount: 5000 }, { mode: "UPI", amount: 5000 },
        { mode: "CARD", amount: 5000 }, { mode: "NETBANKING", amount: 5000 },
      ],
    });
    expect(s.patientPaid).toBe(20000);
    expect(s.patientBalance).toBe(0);
  });

  it("a refund is always the patient's, never the insurer's", () => {
    const s = bill({
      payments: [{ mode: "CASH", amount: 20000 }, { mode: "INSURANCE", amount: 180000 }],
      refunds: [{ amount: 5000 }],
    });
    expect(s.patientPaid).toBe(15000);
    expect(s.patientBalance).toBe(5000);
    expect(s.insurerPaid).toBe(180000);
    expect(s.insuranceReceivable).toBe(0);
  });

  it("an insurer overpayment does not quietly clear the family's share", () => {
    const s = bill({ payments: [{ mode: "INSURANCE", amount: 195000 }] });
    expect(s.patientBalance).toBe(20000);
    expect(s.insuranceReceivable).toBe(0);
  });

  it("an ordinary self-pay bill is wholly the patient's", () => {
    const s = splitInvoice({ totalAmount: 4000, payments: [] });
    expect(s.insuranceCovered).toBe(0);
    expect(s.patientPayable).toBe(4000);
    expect(s.patientBalance).toBe(4000);
  });

  it("a fully covered bill asks the patient for nothing", () => {
    const s = bill({ insuranceCoveredAmount: 200000 });
    expect(s.patientPayable).toBe(0);
    expect(s.patientBalance).toBe(0);
  });

  it("coverage above the bill never makes the payable negative", () => {
    const s = bill({ insuranceCoveredAmount: 999999 });
    expect(s.insuranceCovered).toBe(200000);
    expect(s.patientPayable).toBe(0);
  });

  it("accepts Decimal-style strings straight off a Prisma row", () => {
    const s = splitInvoice({
      totalAmount: "200000.00", insuranceCoveredAmount: "180000.00",
      payments: [{ mode: "CASH", amount: "12000.50" }],
    });
    expect(s.patientBalance).toBe(7999.5);
  });

  it("treats a paisa tail as settled, not owed", () => {
    const s = splitInvoice({
      totalAmount: 100, insuranceCoveredAmount: 0,
      payments: [{ mode: "CASH", amount: 99.995 }],
    });
    expect(s.fullySettled).toBe(true);
  });
});

describe("allocateCoverage - an approval spread across a stay's bills", () => {
  const bills = [
    { id: "ipd", totalAmount: 150000 },
    { id: "pharmacy", totalAmount: 40000 },
    { id: "lab", totalAmount: 10000 },
  ];

  it("fills oldest first, exactly like settlement does", () => {
    expect(allocateCoverage(180000, bills)).toEqual([
      { id: "ipd", covered: 150000 },
      { id: "pharmacy", covered: 30000 },
      { id: "lab", covered: 0 },
    ]);
  });

  it("a bill past the end of the approval is wholly the patient's", () => {
    const out = allocateCoverage(180000, bills);
    expect(out.find((o) => o.id === "lab")!.covered).toBe(0);
  });

  it("covers everything when the approval matches the stay", () => {
    expect(allocateCoverage(200000, bills).every((o, i) => o.covered === bills[i].totalAmount)).toBe(true);
  });

  it("never allocates more than a bill's own total", () => {
    for (const o of allocateCoverage(999999, bills)) {
      const b = bills.find((x) => x.id === o.id)!;
      expect(o.covered).toBeLessThanOrEqual(b.totalAmount);
    }
  });

  it("a rejection covers nothing", () => {
    expect(allocateCoverage(0, bills).every((o) => o.covered === 0)).toBe(true);
  });

  it("allocated total never exceeds the approval", () => {
    for (const approved of [0, 1, 55000, 180000, 200000, 250000]) {
      const sum = allocateCoverage(approved, bills).reduce((s, o) => s + o.covered, 0);
      expect(sum).toBeLessThanOrEqual(Math.min(approved, 200000) + 0.01);
    }
  });
});

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
  claimNo: "JMH2026CLM0001",
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
    expect(a.claimNo).toBe("JMH2026CLM0001");
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

/**
 * THE POLICY'S CO-PAY.
 *
 * The slice of an admissible claim the family carries. The hospital has to
 * COLLECT it - the insurer is not sending it - so the arithmetic that decides
 * how big it is has to be right and has to be the same everywhere it is shown.
 */
describe("the co-pay on a sanctioned amount", () => {
  it("is nothing when the policy has none", () => {
    expect(copayOn(100_000, {})).toBe(0);
    expect(copayOn(100_000, { pct: null, amount: null })).toBe(0);
  });

  it("is the percentage of the sanction the letter quotes", () => {
    expect(copayOn(100_000, { pct: 10 })).toBe(10_000);
    expect(copayOn(160_750, { pct: 20 })).toBe(32_150);
  });

  it("rounds to the paisa, like every other figure on a claim", () => {
    expect(copayOn(33_333, { pct: 10 })).toBe(3_333.3);
  });

  it("takes rupees as stated when both are given - the letter is the authority", () => {
    // TPAs round their own way. If the letter says ₹10,000, that is what the
    // family is charged, whatever 12% of the sanction works out to here.
    expect(copayOn(100_000, { pct: 12, amount: 10_000 })).toBe(10_000);
  });

  it("never exceeds the sanction it comes off", () => {
    // A co-pay bigger than the amount would make the insurer's share negative,
    // and a negative approval spread over a stay's bills is a bill that pays
    // for itself.
    expect(copayOn(50_000, { amount: 80_000 })).toBe(50_000);
    expect(copayOn(50_000, { pct: 100 })).toBe(50_000);
  });

  it("ignores nonsense rather than producing it", () => {
    expect(copayOn(100_000, { pct: 0 })).toBe(0);
    expect(copayOn(100_000, { amount: -5_000 })).toBe(0);
    expect(copayOn(-100, { pct: 10 })).toBe(0);
    expect(copayOn(100_000, { amount: Number.NaN })).toBe(0);
  });
});

describe("a co-pay is the family's, all the way through the split", () => {
  // What the APPROVE path stores: the insurer's NET share.
  const sanctioned = 100_000;
  const copay = copayOn(sanctioned, { pct: 10 });
  const approved = sanctioned - copay;

  it("leaves the insurer owing only its own share", () => {
    const split = splitStay({
      billTotal: 100_000,
      isInsurance: true,
      approval: {
        approved, settled: 0, decided: true, rejected: false,
        pending: false, claimNo: "CLM-1", ref: null,
      },
    });
    expect(split.insuranceApproved).toBe(90_000);
    expect(split.insuranceReceivable).toBe(90_000);
  });

  it("puts the co-pay on the family, to be collected at the counter", () => {
    const split = splitStay({
      billTotal: 100_000,
      isInsurance: true,
      approval: {
        approved, settled: 0, decided: true, rejected: false,
        pending: false, claimNo: "CLM-1", ref: null,
      },
    });
    expect(split.patientPayable).toBe(10_000);
    expect(split.patientDue).toBe(10_000);
  });

  it("lets the family's own deposit settle it, and hands back the rest", () => {
    const split = splitStay({
      billTotal: 100_000,
      advance: 25_000,
      isInsurance: true,
      approval: {
        approved, settled: 0, decided: true, rejected: false,
        pending: false, claimNo: "CLM-1", ref: null,
      },
    });
    expect(split.advanceApplied).toBe(10_000);
    expect(split.patientDue).toBe(0);
    expect(split.refundDue).toBe(15_000);
  });
});

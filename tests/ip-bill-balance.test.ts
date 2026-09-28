import { describe, it, expect, vi, beforeEach } from "vitest";
import { advancePaymentRef, takenOnStayBill } from "@/server/billing/advances";

/**
 * THE IP BILL'S BALANCE ON A STAY THAT HAS BEEN PAID IN FULL.
 *
 * A real discharge (JMH2026IP00104): a Rs 70,000 stay bill settled with the
 * Rs 15,000 deposit plus Rs 55,000 cash at the discharge desk, and every
 * pharmacy bill paid at the window. The IP bill still printed a balance of
 * Rs 57,437. Two things were adding up to it:
 *
 *   - the Rs 55,000 taken against the stay's own invoice was never subtracted -
 *     the sheet took off the deposit and the counters' bills and stopped;
 *   - a ward dispense whose invoice never got raised (the pharmacist retried,
 *     and the retry billed) left a DISPENSED prescription with no invoice, and
 *     its medicines came back as "not yet billed" lines. The safety net that
 *     drops a draft already on an invoice compared "NAME" with the invoice's
 *     "NAME (unit)" and never matched.
 *
 * And under both, a Rs 542 gap: the pharmacy lines were added in before GST
 * while the money taken on them was subtracted with it.
 *
 * The service reaches Prisma at import time, so the client is stubbed with the
 * rows the three reads would return. Nothing here touches a database.
 */

const db: { admission: unknown; batches: unknown[] } = { admission: null, batches: [] };

vi.mock("@/lib/prisma", () => ({
  prisma: {
    admission: { findUnique: async () => db.admission },
    stockBatch: { findMany: async () => db.batches },
    hospitalConfig: { findFirst: async () => null },
  },
}));

const { detailedBillData, medicineMatchKeys } = await import("@/server/services/ipd.service");

const dec = (n: number) => ({ toString: () => n.toFixed(2) });
const at = (iso: string) => new Date(iso);

const IP = "JMH2026IP00104";
const DEPOSIT_SLIP = "JMH2026ADV0035";

/** The stay, shaped as detailedBillData's query returns it. */
function stay(opts: {
  cashAtDischarge: number; orphanRx: boolean;
  /** GST on the pharmacy bill, split evenly into CGST and SGST. */
  pharmacyGst?: number;
  /** What the window took; defaults to the bill's full total. */
  pharmacyPaid?: number;
  /** More Rs 100 pharmacy bills, each collected a paisa short. */
  paisaShortBills?: number;
  /** Still in a bed: no stay bill raised yet. */
  admitted?: boolean;
  /** A Rs 700 test the lab did but never invoiced. */
  unbilledTest?: boolean;
}) {
  const deposit = 15000;
  const pharmacyGst = opts.pharmacyGst ?? 0;
  const pharmacyTotal = 1130 + pharmacyGst;
  const pharmacyPaid = opts.pharmacyPaid ?? pharmacyTotal;
  return {
    id: "adm1", ipNumber: IP, status: opts.admitted ? "ADMITTED" : "DISCHARGED",
    admittedAt: at("2026-09-16T09:58:00Z"), dischargedAt: opts.admitted ? null : at("2026-09-20T09:39:54Z"),
    wardNameAtAdmit: "General Ward", dailyChargeAtAdmit: dec(0), nursePerDay: null,
    payerType: "SELF_PAY", insurer: null, policyNo: null,
    bed: { bedNo: "203", ward: { name: "General Ward", floor: "2ND FLOOR", category: "GENERAL" } },
    doctor: { name: "Dr. A", department: "General Surgery", specialization: null, qualification: null, registrationNo: null },
    patient: { fullName: "Test Patient", displayId: "JMH2026OP00658", age: 40, gender: "MALE", phone: "9000000000" },
    charges: [
      { category: "PROCEDURE", description: "Surgery package", qty: 1, unitPrice: dec(70000), sourceRef: null, createdAt: at("2026-09-17T08:00:00Z") },
    ],
    bedStays: [],
    // What the query hands back: only tests no invoice line is linked to.
    labTests: opts.unbilledTest
      ? [{ testName: "Lipid Profile (LP)", priceAtOrder: dec(700), createdAt: at("2026-09-17T06:37:00Z"), orderGroupId: null, catalog: { code: "LP" } }]
      : [],
    advances: [{ id: "adv1", receiptNo: DEPOSIT_SLIP, amount: dec(deposit), mode: "UPI", createdAt: at("2026-09-17T09:58:36Z") }],
    // What the query hands back: only prescriptions with no invoice behind them.
    prescriptionUploads: opts.orphanRx
      ? [{
          createdAt: at("2026-09-18T11:31:50Z"),
          items: [{ medicineName: "KLEINCEF SB 1.5GM INJ", qty: 2, dosage: null, medicineId: "med-kleincef" }],
        }]
      : [],
    invoices: [
      ...(opts.admitted ? [] : [{
        receiptNo: "JMH20262578", source: "IPD", createdAt: at("2026-09-20T09:39:54Z"), payer: "SELF_PAY",
        discountAmount: dec(0), cgstAmount: dec(0), sgstAmount: dec(0), taxableAmount: dec(70000), totalAmount: dec(70000),
        payments: [
          ...(opts.cashAtDischarge > 0
            ? [{ amount: dec(opts.cashAtDischarge), mode: "CASH", reference: null, createdAt: at("2026-09-20T09:39:54.072Z") }]
            : []),
          { amount: dec(deposit), mode: "UPI", reference: advancePaymentRef(IP, DEPOSIT_SLIP), createdAt: at("2026-09-20T09:39:54.140Z") },
        ],
        refunds: [],
        items: [{ description: "Surgery package", hsnSac: null, qty: 1, unitPrice: dec(70000), amount: dec(70000), batch: null }],
      }]),
      {
        receiptNo: "JMH20262452", source: "PHARMACY", createdAt: at("2026-09-18T11:31:55Z"), payer: "SELF_PAY",
        discountAmount: dec(0), cgstAmount: dec(pharmacyGst / 2), sgstAmount: dec(pharmacyGst / 2),
        taxableAmount: dec(1130), totalAmount: dec(pharmacyTotal),
        payments: pharmacyPaid > 0
          ? [{ amount: dec(pharmacyPaid), mode: "CASH", reference: null, createdAt: at("2026-09-18T11:41:49Z") }]
          : [],
        refunds: [],
        // How the pharmacy writes a single-unit line - see dispense().
        items: [{
          description: "KLEINCEF SB 1.5GM INJ (unit) · Batch CI-256A15F", hsnSac: "3004", qty: 2,
          unitPrice: dec(565), amount: dec(1130), batch: { batchNo: "CI-256A15F", expiryDate: at("2027-06-30T00:00:00Z") },
        }],
      },
      ...Array.from({ length: opts.paisaShortBills ?? 0 }, (_, k) => ({
        receiptNo: `JMH2026900${k}`, source: "PHARMACY", createdAt: at(`2026-09-19T0${k}:00:00Z`), payer: "SELF_PAY",
        discountAmount: dec(0), cgstAmount: dec(0), sgstAmount: dec(0), taxableAmount: dec(100), totalAmount: dec(100),
        payments: [{ amount: dec(99.99), mode: "CASH", reference: null, createdAt: at(`2026-09-19T0${k}:05:00Z`) }],
        refunds: [],
        items: [{ description: `EASY FIX ${k} (unit) · Batch B${k}`, hsnSac: "3004", qty: 1, unitPrice: dec(100), amount: dec(100), batch: null }],
      })),
    ],
  };
}

beforeEach(() => {
  db.batches = [{ medicineId: "med-kleincef", mrp: dec(565), packSize: 1 }];
});

describe("the IP bill on a stay paid in full", () => {
  it("shows no balance once the discharge desk has taken the rest in cash", async () => {
    db.admission = stay({ cashAtDischarge: 55000, orphanRx: true });
    const bill = await detailedBillData("adm1");
    expect(bill.netPayable).toBe("0.00");
  });

  it("counts the cash taken at discharge as paid at the counter, so the totals block adds up", async () => {
    db.admission = stay({ cashAtDischarge: 55000, orphanRx: false });
    const bill = await detailedBillData("adm1");
    // Net - advance - paid at counter = balance, on the paper as printed.
    expect(bill.netBill).toBe("71130.00");
    expect(bill.advance).toBe("15000.00");
    expect(bill.counterPaid).toBe("56130.00");
    expect(bill.netPayable).toBe("0.00");
  });

  it("still asks for what the desk has NOT taken", async () => {
    // Only the deposit applied: Rs 55,000 of the stay bill is genuinely owed.
    db.admission = stay({ cashAtDischarge: 0, orphanRx: false });
    const bill = await detailedBillData("adm1");
    expect(bill.netPayable).toBe("55000.00");
  });

  it("does not bill a medicine twice because a failed dispense left its prescription behind", async () => {
    // Mid-stay, where unbilled lines still count - so only the name match can
    // keep the strip the pharmacy already billed from coming back as a draft.
    db.admission = stay({ cashAtDischarge: 0, orphanRx: true, admitted: true });
    const bill = await detailedBillData("adm1");
    const pharmacy = bill.groups.find((g) => g.title === "PHARMACY CHARGES")!;
    expect(pharmacy.lines).toHaveLength(1);
    expect(pharmacy.lines.some((l) => l.draft)).toBe(false);
    expect(bill.draftTotal).toBe("0.00");
  });

  it("still charges a test nobody has invoiced while the patient is in a bed", async () => {
    db.admission = stay({ cashAtDischarge: 0, orphanRx: false, admitted: true, unbilledTest: true });
    const bill = await detailedBillData("adm1");
    expect(bill.draftTotal).toBe("700.00");
    expect(bill.groups.some((g) => g.lines.some((l) => l.draft && l.description === "Lipid Profile (LP)"))).toBe(true);
  });

  it("carries only what was billed once the stay's final bill is raised", async () => {
    // Discharged and settled: a test nobody invoiced must not reopen the stay.
    db.admission = stay({ cashAtDischarge: 55000, orphanRx: true, unbilledTest: true });
    const bill = await detailedBillData("adm1");
    expect(bill.groups.flatMap((g) => g.lines).some((l) => l.draft)).toBe(false);
    expect(bill.draftTotal).toBe("0.00");
    expect(bill.netPayable).toBe("0.00");
  });

  it("carries a paid pharmacy bill's GST, so the Net Amount matches what was received", async () => {
    // The lines print at Rs 1,130 before tax; the window took the bill's
    // Rs 1,186.50 total. The sheet's Net must include the Rs 56.50 too.
    db.admission = stay({ cashAtDischarge: 55000, orphanRx: false, pharmacyGst: 56.5 });
    const bill = await detailedBillData("adm1");
    expect(bill.gst).toBe("56.50");
    expect(bill.netBill).toBe("71186.50");
    expect(bill.netPayable).toBe("0.00");
  });

  it("asks for an unpaid pharmacy bill's full total, tax included", async () => {
    db.admission = stay({ cashAtDischarge: 55000, orphanRx: false, pharmacyGst: 56.5, pharmacyPaid: 0 });
    const bill = await detailedBillData("adm1");
    expect(bill.netPayable).toBe("1186.50");
  });

  it("does not print a paisa the window left behind as a balance", async () => {
    db.admission = stay({ cashAtDischarge: 55000, orphanRx: false, pharmacyPaid: 1129.99 });
    const bill = await detailedBillData("adm1");
    expect(bill.netPayable).toBe("0.00");
  });

  it("does not add up several bills' stray paise into a balance none of them has", async () => {
    db.admission = stay({ cashAtDischarge: 55000, orphanRx: false, paisaShortBills: 3 });
    const bill = await detailedBillData("adm1");
    expect(bill.netPayable).toBe("0.00");
  });

  it("lists the deposit once in Payment Details, not again as its adjustment", async () => {
    db.admission = stay({ cashAtDischarge: 55000, orphanRx: false });
    const bill = await detailedBillData("adm1");
    expect(bill.payments.map((p) => [p.invoiceNo, p.amount])).toEqual([
      [DEPOSIT_SLIP, "15000.00"],
      ["JMH20262452", "1130.00"],
      ["JMH20262578", "55000.00"],
    ]);
  });
});

describe("money taken against the stay's own bill", () => {
  const deposit = { amount: 15000, reference: advancePaymentRef(IP, DEPOSIT_SLIP) };

  it("leaves the carried-over deposit out - the sheet subtracts it on its own line", () => {
    expect(takenOnStayBill([deposit, { amount: 55000, reference: null }])).toBe(55000);
  });

  it("keeps a UPI payment whose reference is a transaction id", () => {
    expect(takenOnStayBill([{ amount: 2000, reference: "UPI 4471 2290" }])).toBe(2000);
  });

  it("is net of refunds and never negative", () => {
    expect(takenOnStayBill([{ amount: 5000, reference: null }], [{ amount: 1200 }])).toBe(3800);
    expect(takenOnStayBill([deposit], [{ amount: 500 }])).toBe(0);
  });
});

describe("matching a prescription to a billed pharmacy line", () => {
  it("answers to the name without the unit the pharmacy writes on a single-unit line", () => {
    expect(medicineMatchKeys("KLEINCEF SB 1.5GM INJ (unit)")).toContain("kleincef sb 1.5gm inj");
  });

  it("still answers to its full name", () => {
    expect(medicineMatchKeys("Dolo 650 Tablet")).toEqual(["dolo 650 tablet"]);
    expect(medicineMatchKeys("NS 500 ML FLAT (unit)")).toContain("ns 500 ml flat (unit)");
  });
});

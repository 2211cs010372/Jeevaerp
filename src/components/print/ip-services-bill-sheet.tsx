"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import JsBarcode from "jsbarcode";
import { api, ApiClientError } from "@/lib/api-client";
import { amountInWords } from "@/lib/amount-words";
import { BillHead, PrintToolbar, type HospitalInfo } from "@/components/print/stationery";

/**
 * IP SERVICES BILL - the same stay as the IP bill, read the way a self-paying
 * family reads it.
 *
 * THE IP BILL IS UNCHANGED AND STILL THE CLAIM DOCUMENT. It prints one gross
 * figure, takes the discount off the bottom and hands a TPA a number to assess.
 * This sheet exists for the conversation that one cannot hold - the discount
 * conversation at the discharge counter - and it is deliberately the SAME
 * FORMAT, because a family holding both must not have to learn two documents.
 *
 * What is different, and why every difference is here:
 *
 *   THE HOSPITAL'S OWN SERVICES, AND NOTHING ELSE. The bed, the ward and the
 *   consultant are the only charges a discount may touch, and they are the only
 *   ones printed. The pharmacy and the lab bill at their own windows on their
 *   own invoices; reprinted here they handed the family a second copy of a bill
 *   already in their hand and ran a long stay onto extra pages. Off the paper,
 *   and off the figure asked for at the foot of it.
 *
 *   PAID SAYS PAID, ON THE LINE. The IP bill deliberately carries no per-line
 *   status - it is a claim sheet, and paid-vs-due is a money question its totals
 *   answer once. This sheet is the opposite document: it is asking a family for
 *   a number TODAY, so a service already settled says so where the family's
 *   finger is, instead of being silently netted off the bottom of the page.
 *
 *   THE MONEY TABLE IS STILL A GRID, not a stack. Amount, discount, paid and
 *   due read across under their own headings, and the Total rules off under
 *   them; as a column of labelled rows nothing lines up under anything.
 *
 * WHO IT IS FOR is decided by the server and refused there - a self-paying stay,
 * or one an insurer refused that has been moved onto the family. A discounted
 * "pay this now" sheet printed for a cashless stay asks a family for money the
 * insurer is carrying, and the desk that prints it will collect it.
 */

interface BillLine {
  date: string | null; issueNo: string | null; code: string | null;
  description: string; batchNo: string | null; expiry: string | null;
  rate: string; qty: number; amount: string;
  draft?: boolean;
  priced?: boolean;
  /** Where the counter bill this line came off stands. Read HERE, unlike on the
   *  IP bill - see the note at the top. */
  paidStatus?: "PAID" | "PART" | "DUE";
}
interface BillGroup {
  title: string; lines: BillLine[]; total: string;
  byDate: boolean;
  bucket: "SERVICES" | "LAB" | "PHARMACY";
  discountable: boolean;
}
interface BillPayment { invoiceNo: string; date: string; mode: string; amount: string }
interface BillSource {
  receiptNo: string; source: string; date: string;
  total: string; paid: string; status: "PAID" | "PART" | "DUE";
}
interface Block {
  gross: string; discount: string; net: string; paid: string; due: string; settled: boolean;
}
interface Data {
  hospital: (HospitalInfo & { logoDataUrl?: string | null }) | null;
  provisional: boolean;
  billNo: string;
  billedAt: string;
  patient: { fullName: string; displayId: string; age: number | null; gender: string | null; phone: string };
  admission: {
    ipNumber: string; doctor: string; department: string;
    ward: string; bedNo: string; admittedAt: string; dischargedAt: string | null;
    roomInfo: string; dischargeType: string;
    qualification: string | null; specialization: string | null;
    registrationNo: string | null;
  };
  sourceType: string;
  insurer: string | null;
  policyNo: string | null;
  groups: BillGroup[];
  payments: BillPayment[];
  sourceBills: BillSource[];
  eligible: boolean;
  basis: "SELF_PAY" | "INSURANCE_REFUSED" | "NONE";
  eligibilityNote: string;
  money: {
    /** The only block on this sheet - see the note at the top. */
    services: Block;
    gross: string; discount: string; discountUnapplied: string; gst: string; roundOff: string;
    netBill: string; paidTotal: string; dueBeforeAdvance: string;
    advance: string; advanceApplied: string; netPayable: string; refundDue: string;
  };
}

const money = (v: string | number) =>
  Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const GENDER: Record<string, string> = { MALE: "MALE", FEMALE: "FEMALE", OTHER: "OTHER" };

const pad = (n: number) => String(n).padStart(2, "0");
/** A Date as `<input type="datetime-local">` wants it: local wall clock. */
const toLocalInput = (d: Date): string =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
/** Some doctors are stored with the honorific already on the name; adding it
 *  unconditionally printed "Dr. Dr. Aditya Bellala" on a bill. */
const withDr = (name: string) => (/^dr\.?\s/i.test(name.trim()) ? name.trim() : `Dr. ${name.trim()}`);
/** dd-mm-yyyy, assembled by hand - see the note in detailed-bill-sheet: en-IN
 *  gives slashes and the ICU build underneath can move the output. */
const d = (iso: string | null) => {
  if (!iso) return "";
  const x = new Date(iso);
  return `${String(x.getDate()).padStart(2, "0")}-${String(x.getMonth() + 1).padStart(2, "0")}-${x.getFullYear()}`;
};
/** dd-mm-yyyy date only (timings removed as requested). */
const dt = (iso: string | null) => {
  if (!iso) return "-";
  return d(iso);
};

const SOURCE_LABEL: Record<string, string> = {
  PHARMACY: "Pharmacy", LAB: "Laboratory", CONSULTATION: "OP Consultation", OTHER: "Services",
};
const MODE_LABEL: Record<string, string> = {
  CASH: "Cash", UPI: "UPI", CARD: "Card", NETBANKING: "Net banking",
  INSURANCE: "Insurance", OTHER: "Other",
};
/** What the one block this sheet bills is called on the money table. */
const BLOCK_LABEL: Record<string, string> = {
  SERVICES: "Hospital services",
};

/** Lines bucketed under their own date, oldest first - a Map keeps insertion
 *  order and the service sends them chronologically. */
function groupLinesByDate(lines: BillLine[]): [string, BillLine[]][] {
  const byDay = new Map<string, BillLine[]>();
  for (const l of lines) {
    const day = d(l.date);
    byDay.set(day, [...(byDay.get(day) ?? []), l]);
  }
  return [...byDay.entries()].sort(([a], [z]) => (a === "" ? -1 : z === "" ? 1 : 0));
}

/**
 * One printed line.
 *
 * THE PAID MARKER IS THE ONE THING THIS ROW HAS THAT THE IP BILL'S DOES NOT.
 * It is set small and in the ink of the page rather than in colour, because it
 * has to survive a photocopy and a fax - the two ways a bill leaves this
 * building - and because it is a fact about the line, not a warning.
 *
 * Nothing is marked DUE. Every unmarked line is due; saying so on forty rows
 * turns the sheet into an argument about who owes what, which is exactly the
 * mistake the IP bill's own history records.
 */
function BillRow({ l, withDate, indent }: { l: BillLine; withDate?: boolean; indent?: boolean }) {
  return (
    <tr>
      <td className={`py-[3px] pr-1 font-semibold ${indent ? "pl-3" : ""}`}>
        {withDate && l.date && <span className="font-mono text-[8.5px]">{dt(l.date)} - </span>}
        {l.description}
        {l.paidStatus === "PAID" && <span className="paid-chip">PAID</span>}
        {l.paidStatus === "PART" && <span className="paid-chip">PART PAID</span>}
      </td>
      <td className="py-[3px] pr-1 text-right font-mono font-medium">{l.qty}</td>
      {/* An unpriced draft prints a dash, never 0.00 - a zero in a money column
          reads as "free", which is a different claim from "not priced yet". */}
      <td className="py-[3px] pr-1 text-right font-mono font-medium">{l.draft && !l.priced ? "—" : money(l.rate)}</td>
      <td className="py-[3px] text-right font-mono font-medium">{l.draft && !l.priced ? "—" : `₹${money(l.amount)}`}</td>
    </tr>
  );
}

export function IpServicesBillSheet() {
  const { admissionId } = useParams<{ admissionId: string }>();
  const [b, setB] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Printing onto the hospital's own pre-printed pad - what is in the tray. */
  const [onStationery, setOnStationery] = useState(true);
  /**
   * THE DISCHARGE DATE ON THIS BILL, WHEN THE PORTAL HAS NOT STAMPED ONE.
   * Same box and same rule as the IP bill's: it changes the PAPER only. Nothing
   * is saved, the stay is not closed, and not one figure below moves.
   */
  const [pickedDischarge, setPickedDischarge] = useState("");
  const ipBar = useRef<SVGSVGElement>(null);
  const billBar = useRef<SVGSVGElement>(null);

  useEffect(() => {
    api.get<Data>(`/ipd/admissions/${admissionId}/services-bill`)
      .then(setB)
      .catch((e) => setError(e instanceof ApiClientError ? e.message : "Couldn't load the bill."));
  }, [admissionId]);

  useEffect(() => {
    if (!b) return;
    const draw = (node: SVGSVGElement | null, value: string) => {
      if (!node) return;
      try {
        JsBarcode(node, value, { format: "CODE128", width: 1.3, height: 34, displayValue: false, margin: 0 });
      } catch { /* an unencodable value must not take the whole bill down */ }
    };
    draw(ipBar.current, b.admission.ipNumber);
    draw(billBar.current, b.billNo);
  }, [b]);

  if (error) return <div className="p-10 text-center text-[14px] text-[#8a3b2e]">{error}</div>;
  if (!b) return <div className="p-10 text-center text-[14px] text-[#5a6a66]">Loading…</div>;

  // ── A CASHLESS STAY GETS NOTHING BUT THE REASON ──
  // Refused on the page as well as at the service, and refused BEFORE the sheet
  // is assembled rather than as a banner over it: a printable page with a
  // warning on it is a page somebody prints and hands over.
  if (!b.eligible) {
    return (
      <div className="mx-auto max-w-[600px] p-10 text-center">
        <div className="text-[15px] font-semibold text-[#3a4744]">This stay is not billed on this sheet</div>
        <p className="mt-2 text-[13.5px] leading-relaxed text-[#5a6a66]">{b.eligibilityNote}</p>
        <a href={`/print/bill/${admissionId}`}
          className="mt-5 inline-block rounded-lg border border-[#c8ccc9] bg-white px-3.5 py-2 text-[13px] font-medium text-[#0b5f55] hover:border-[#0b5f55]">
          Open the IP bill instead
        </a>
      </div>
    );
  }

  // Only a date this stay could have - nobody leaves before they arrive.
  const pickedAt = pickedDischarge ? new Date(pickedDischarge) : null;
  const pickedBad = !!pickedAt && (Number.isNaN(pickedAt.getTime()) || pickedAt < new Date(b.admission.admittedAt));
  const pickedIso = pickedAt && !pickedBad ? pickedAt.toISOString() : null;

  const m = b.money;

  return (
    <div className="print-stage">
      <style>{CSS(onStationery)}</style>
      <div className="mx-auto mb-2 flex w-full max-w-[210mm] flex-wrap items-center justify-end gap-x-5 gap-y-2 print:hidden">
        <label className="flex items-center gap-2 text-[13px] text-[#3a4744]">
          Discharge date on this bill
          <input type="datetime-local" value={pickedDischarge}
            min={toLocalInput(new Date(b.admission.admittedAt))}
            onChange={(e) => setPickedDischarge(e.target.value)}
            className="rounded border border-[#c8ccc9] bg-white px-2 py-1 text-[12.5px] text-[#3a4744]" />
        </label>
        {pickedDischarge && (
          <button type="button" onClick={() => setPickedDischarge("")}
            className="rounded border border-[#c8ccc9] bg-white px-2.5 py-1 text-[12px] font-medium text-[#3a4744] hover:border-[#0b5f55] hover:text-[#0b5f55]">
            Use the recorded date
          </button>
        )}
        <label className="flex items-center gap-2 text-[13px] text-[#3a4744]">
          <input type="checkbox" checked={onStationery} onChange={(e) => setOnStationery(e.target.checked)} />
          Printing on the hospital&apos;s pre-printed sheet
        </label>
      </div>

      {pickedBad && (
        <div className="mx-auto mb-2 w-full max-w-[210mm] rounded-lg border border-[#d9b8ae] bg-[#fdf3f0] px-3 py-2 text-[12.5px] text-[#8a3b2e] print:hidden">
          That is before the admission on {dt(b.admission.admittedAt)}, so the bill is still printing the recorded date.
        </div>
      )}

      {pickedIso && (
        <div className="mx-auto mb-2 w-full max-w-[210mm] rounded-lg border border-[#c8ccc9] bg-white px-3 py-2 text-[12.5px] leading-relaxed text-[#3a4744] print:hidden">
          This bill prints <b>{dt(pickedIso)}</b> as the discharge date. Nothing is saved - the stay is not closed and
          every figure below is unchanged.
        </div>
      )}

      {/* The desk sees WHY this sheet is allowed before it prints it. On paper it
          is a line under the header; here it is the answer to "should I be
          printing this one at all". */}
      <div className="mx-auto mb-2 w-full max-w-[210mm] rounded-lg border border-[#c8ccc9] bg-white px-3 py-2 text-[12.5px] leading-relaxed text-[#3a4744] print:hidden">
        {b.eligibilityNote} The discount applies to hospital services only - the pharmacy and the laboratory print at cost.
      </div>

      <PrintToolbar title={`IP services bill · ${b.admission.ipNumber}`} />

      <div id="print-sheet">
        <table className="doc">
          <thead>
            <tr>
              <td className="pb-1">
                {!onStationery && <BillHead hospital={b.hospital} />}
                <div className="mt-1 text-center text-[13px] font-bold tracking-wide">
                  IP SERVICES BILL
                </div>
              </td>
            </tr>
          </thead>

          <tbody>
            <tr>
              <td>
                <div className="keep-together mt-2 grid grid-cols-2 gap-x-4 border border-[#333] p-1.5">
                  <F k="MR Number" v={b.patient.displayId} />
                  <F k="Patient Reg.No." v={b.admission.ipNumber} />
                  <F k="Patient Name" v={b.patient.fullName.toUpperCase()} strong />
                  <F k="Phone" v={b.patient.phone} />
                  <F k="Age / Gender" v={`${b.patient.age != null ? `${b.patient.age}Y` : "-"} / ${GENDER[b.patient.gender ?? ""] ?? "-"}`} />
                  <F k="Room Info" v={b.admission.roomInfo} />
                  <F k="Admit Date" v={dt(b.admission.admittedAt)} />
                  <F k="Date of Discharge" v={pickedIso ? dt(pickedIso) : b.admission.dischargedAt ? dt(b.admission.dischargedAt) : "-"} />
                  <F k="Bill No" v={b.billNo} strong />
                  <F k="Discharge Type" v={pickedIso && b.admission.dischargeType === "ADMITTED" ? "DISCHARGED" : b.admission.dischargeType} />
                  {/* SELF, always - that is the gate this sheet passed to exist.
                      A stay the insurer refused says so instead of printing the
                      insurer's name against a bill they are not paying. */}
                  <F k="Source Type" v={b.basis === "SELF_PAY" ? "SELF" : "SELF (insurance refused)"} />
                </div>

                <div className="keep-together mt-1.5 border border-[#333]">
                  <div className="border-b border-[#333] bg-[#eef2f1] px-1.5 py-[3px] text-[9.5px] font-bold uppercase">
                    Doctor Information
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 p-1.5">
                    <F k="Consultant Doctor" v={withDr(b.admission.doctor)} strong />
                    <F k="Department" v={b.admission.department} />
                    <F k="Specialization" v={b.admission.qualification || b.admission.specialization || "-"} />
                    <F k="Reg. No." v={b.admission.registrationNo || "-"} />
                  </div>
                </div>

                <div className="mt-1.5 text-[9.5px] font-bold uppercase">Payment Information</div>

                <table className="mt-1 w-full border-collapse text-[9.5px]">
                  <thead>
                    <tr className="border-b border-t border-[#333]">
                      <Th w="60%">Service Type</Th>
                      <Th w="10%" right>Quantity</Th>
                      <Th w="13%" right>Rate</Th>
                      <Th w="17%" right>Amount(₹)</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {b.groups.map((g) => (
                      <Fragment key={g.title}>
                        {/* THE HEADING CARRIES THE SUBTOTAL AND THE RULE.
                            Every section here is the hospital's own and therefore
                            discountable - the pharmacy and the lab are not on
                            this sheet at all - and the marker sits on the section
                            rather than in a footnote, because the question is
                            asked ABOUT A SECTION and asked while the family's
                            finger is on it. */}
                        <tr className="border-t border-[#333]">
                          <td colSpan={2} className="pb-[3px] pt-2 text-[9.5px] font-bold uppercase">
                            {g.title}
                            <span className="ml-1.5 text-[8px] font-semibold uppercase tracking-wide text-[#4a5a55]">
                              · discount applies
                            </span>
                          </td>
                          <td colSpan={2} className="pb-[3px] pt-2 text-right font-mono text-[9.5px] font-bold">₹{money(g.total)}</td>
                        </tr>

                        {g.byDate
                          ? groupLinesByDate(g.lines).map(([day, lines]) => (
                            <Fragment key={`${g.title}-${day}`}>
                              {day && (
                                <tr>
                                  <td colSpan={4} className="pb-[2px] pt-[5px] font-mono text-[9px] font-semibold">{day}</td>
                                </tr>
                              )}
                              {lines.map((l, i) => <BillRow key={`${g.title}-${day}-${i}`} l={l} indent />)}
                            </Fragment>
                          ))
                          : g.lines.map((l, i) => <BillRow key={`${g.title}-${i}`} l={l} withDate />)}
                      </Fragment>
                    ))}
                  </tbody>
                </table>

                {b.sourceBills.length > 0 && (
                  <div className="keep-together mt-3">
                    <div className="text-[9.5px] font-bold uppercase">Bills included in this statement</div>
                    <table className="mt-1 w-full border-collapse text-[9.5px]">
                      <thead>
                        <tr className="border-b border-t border-[#333]">
                          <Th w="28%">Invoice No</Th>
                          <Th w="20%">Date</Th>
                          <Th w="18%">Counter</Th>
                          <Th w="15%" right>Amount(₹)</Th>
                          <Th w="15%" right>Paid(₹)</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {/* THE PAID COLUMN IS BACK, and it is back for this sheet
                            only. On the claim bill it stated the same fact twice
                            and read as two. Here it IS the fact the sheet is
                            about: what has already been settled against the stay,
                            which is what the block below takes off. A family
                            checking a receipt in their hand finds it on this row.
                            THE PHARMACY'S AND THE LAB'S INVOICES ARE NOT LISTED -
                            a receipt number here says the bill is included in
                            this statement, and theirs are not. */}
                        {b.sourceBills.map((x) => (
                          <tr key={x.receiptNo}>
                            <td className="py-[3px] pr-1 font-mono text-[8.5px]">{x.receiptNo}</td>
                            <td className="py-[3px] pr-1 font-mono text-[8.5px]">{dt(x.date)}</td>
                            <td className="py-[3px] pr-1">{SOURCE_LABEL[x.source] ?? x.source}</td>
                            <td className="py-[3px] pr-1 text-right font-mono">₹{money(x.total)}</td>
                            <td className="py-[3px] text-right font-mono">
                              {Number(x.paid) > 0 ? `₹${money(x.paid)}` : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {b.payments.length > 0 && (
                  <div className="keep-together mt-3">
                    <div className="text-[9.5px] font-bold uppercase">Payment Details</div>
                    <table className="mt-1 w-full border-collapse text-[9.5px]">
                      <thead>
                        <tr className="border-b border-t border-[#333]">
                          <Th w="8%">S.NO</Th>
                          <Th w="30%">Invoice No</Th>
                          <Th w="20%">Date</Th>
                          <Th w="20%">Payment Mode</Th>
                          <Th w="16%" right>Amount(₹)</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {b.payments.map((p, i) => (
                          <tr key={`${p.invoiceNo}-${i}`}>
                            <td className="py-[3px] pr-1 font-mono text-[8.5px]">{i + 1}</td>
                            <td className="py-[3px] pr-1 font-mono text-[8.5px]">{p.invoiceNo}</td>
                            <td className="py-[3px] pr-1 font-mono text-[8.5px]">{dt(p.date)}</td>
                            <td className="py-[3px] pr-1">{MODE_LABEL[p.mode] ?? p.mode}</td>
                            <td className="py-[3px] text-right font-mono">₹{money(p.amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* ── THE THREE BLOCKS ── the whole reason this sheet exists, as a
            grid rather than a stack of labelled rows: amount, discount, paid
            and due across three blocks is twelve figures, and in a column
            nothing lines up under anything. */}
                <div className="keep-together mt-4">
                  <div className="text-[9.5px] font-bold uppercase">Bill Summary</div>
                  <table className="mt-1 w-full border-collapse text-[9.5px]">
                    <thead>
                      <tr className="border-b border-t border-[#333]">
                        <Th w="34%">Head</Th>
                        <Th w="17%" right>Amount(₹)</Th>
                        <Th w="16%" right>Discount(₹)</Th>
                        <Th w="16%" right>Paid(₹)</Th>
                        <Th w="17%" right>Due(₹)</Th>
                      </tr>
                    </thead>
                    <tbody>
                      <BlockRow label={BLOCK_LABEL.SERVICES} note="bed, ward services and consultation" blk={m.services} />
                      {/* GST GETS ITS OWN ROW RATHER THAN A NOTE ON THE SERVICES
                    LINE. Folded into that row's note, the Amount column no
                    longer added up to the Total beside it, and a family
                    checking the arithmetic across found it short by exactly the
                    tax - which is the one discrepancy on a bill nobody accepts
                    an explanation for. It is not a fourth block and does not
                    read as one: it is a tax line, labelled as the tax on the
                    only block that carries any. Printed only where there IS
                    GST, which on a stay bill is the exception. */}
                      {Number(m.gst) > 0 && (
                        <tr>
                          <td className="py-[3px] pr-1">
                            <span className="font-semibold">GST</span>
                            <span className="ml-1 text-[8px] text-[#4a5a55]">on hospital services</span>
                          </td>
                          <td className="py-[3px] pr-1 text-right font-mono font-medium">₹{money(m.gst)}</td>
                          <td className="py-[3px] pr-1 text-right font-mono font-medium">—</td>
                          <td className="py-[3px] pr-1 text-right font-mono font-medium">—</td>
                          <td className="py-[3px] text-right font-mono font-semibold">—</td>
                        </tr>
                      )}
                      <tr className="border-t border-[#333]">
                        <td className="py-[4px] pr-1 font-bold uppercase">Total</td>
                        {/* Gross AND the GST, so Amount − Discount − Paid is the
                      Due printed beside it. */}
                        <td className="py-[4px] pr-1 text-right font-mono font-bold">₹{money(Number(m.gross) + Number(m.gst))}</td>
                        <td className="py-[4px] pr-1 text-right font-mono font-bold">
                          {Number(m.discount) > 0 ? `₹${money(m.discount)}` : "—"}
                        </td>
                        <td className="py-[4px] pr-1 text-right font-mono font-bold">
                          {Number(m.paidTotal) > 0 ? `₹${money(m.paidTotal)}` : "—"}
                        </td>
                        <td className="py-[4px] text-right font-mono font-bold">₹{money(m.dueBeforeAdvance)}</td>
                      </tr>
                    </tbody>
                  </table>

                  {/* A discount agreed beyond the hospital's own charges is NOT
              quietly taken off the medicines - the service caps it and this
              says so, because otherwise the sheet and the invoice the counter
              raised would disagree by that amount and nobody would know why. */}
                  {Number(m.discountUnapplied) > 0 && (
                    <div className="mt-1.5 text-[8.5px] leading-relaxed">
                      ₹{money(m.discountUnapplied)} of the agreed discount could not be applied: it is larger than the
                      hospital&apos;s own services on this stay, and medicines and tests are billed at cost.
                    </div>
                  )}
                </div>

                {/* ── THE MONEY ── kept whole, and on the right where the eye goes. */}
                <div className="keep-together mt-4 flex items-start justify-between gap-8">
                  <div className="min-w-0 flex-1">
                    <div className="flex gap-2 text-[9.5px]">
                      <span className="w-[92px] shrink-0 font-semibold">Rupees in words</span>
                      <span>: <span className="font-semibold uppercase">{amountInWords(m.netBill)}</span></span>
                    </div>
                    <div className="mt-6">
                      <div className="w-[190px] border-b border-[#333]" />
                      <div className="mt-1 text-[9px] font-bold">Patient/Attendant Signatory</div>
                    </div>
                  </div>

                  <table className="w-[250px] text-[10px]">
                    <tbody>
                     


                      <T k="Total Amount" v={money(m.gross)} />
                      <T k="Advance Paid" v={money(m.advance)} />
                      <T k="Discount" v={money(m.discount)} />
                      <T k="Balance Due" v={money(m.netPayable)} strong />

                      {/* NO "…of which not yet billed" SPLIT. The Total is the
                  Total. Carving out the part no counter had invoiced yet
                  described the hospital's paperwork, not the family's debt -
                  and a caveat sitting inside the money block reads as a figure
                  that might come off, which it never does. */}
                      {Number(m.gst) > 0 && <T k="Total GST" v={money(m.gst)} />}
                      {/* The bills are whole rupees (lib/money-round); their round-offs,
                          summed, are what closes lines-plus-tax onto what was billed. */}
                      {Number(m.roundOff) !== 0 && <T k="Round Off" v={money(m.roundOff)} />}
                      <T k="Net Amount" v={money(m.netBill)} rule strong />

                      {/* {Number(m.paidTotal) > 0 && <T k="Already Paid" v={money(m.paidTotal)} />}
                      {Number(m.advanceApplied) > 0 && <T k="Advance Paid" v={money(m.advanceApplied)} />} */}
                      {/* A deposit left over is HANDED BACK, and it prints as its
                    own line rather than as a negative balance - a family
                    reading "-2,000.00" at the foot of a bill does not read
                    it as a refund. */}
                      {Number(m.refundDue) > 0 && <T k="Refund Due" v={money(m.refundDue)} />}
                    </tbody>
                  </table>
                </div>

                {/* <div className="keep-together mt-6 flex items-end justify-between gap-8">

                  <div className="text-[9px]">
                    <div className="flex gap-2"><span className="w-[82px] font-semibold">Bill date</span><span>: {dt(b.billedAt)}</span></div>
                    <div className="flex gap-2"><span className="w-[82px] font-semibold">Print Date</span><span>: {dt(new Date().toISOString())}</span></div>
                  </div>

                </div> */}

                <div className="mt-4 border-t border-[#333] pt-1 text-center text-[8.5px] text-[#57655f]">
                  Computer-generated bill. Hospital services only - medicines and investigations are billed separately
                  at the pharmacy and laboratory counters, on their own invoices.
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * One block on the summary grid: what it came to, what came off, what is left.
 *
 * Amount here is the block's own subtotal - the same figure printed on its
 * section heading above - so a reader can put a finger on the two and see they
 * are the same number. GST is a row of its own further down, for the reason
 * given there.
 */
function BlockRow({ label, note, blk }: { label: string; note: string; blk: Block }) {
  return (
    <tr>
      <td className="py-[3px] pr-1">
        <span className="font-semibold">{label}</span>
        <span className="ml-1 text-[8px] text-[#4a5a55]">{note}</span>
      </td>
      <td className="py-[3px] pr-1 text-right font-mono font-medium">₹{money(blk.gross)}</td>
      <td className="py-[3px] pr-1 text-right font-mono font-medium">
        {Number(blk.discount) > 0 ? `₹${money(blk.discount)}` : "—"}
      </td>
      <td className="py-[3px] pr-1 text-right font-mono font-medium">
        {Number(blk.paid) > 0 ? `₹${money(blk.paid)}` : "—"}
      </td>
      <td className="py-[3px] text-right font-mono font-semibold">
        ₹{money(blk.due)}
        {/* SETTLED SAYS SO, but only where money was actually taken - a block
            with nothing on it is not "paid", it is empty. */}
        {blk.settled && Number(blk.paid) > 0 && <span className="paid-chip">PAID</span>}
      </td>
    </tr>
  );
}

/** One "Label : value" row inside the header boxes. */
function F({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className="flex gap-1 py-[1.5px] text-[9.5px] leading-tight">
      <span className="w-[104px] shrink-0 font-semibold">{k}</span>
      <span className="shrink-0">:</span>
      <span className={strong ? "font-bold" : "font-semibold"}>{v}</span>
    </div>
  );
}

function T({ k, v, rule, strong }: { k: string; v: string; rule?: boolean; strong?: boolean }) {
  return (
    <tr className={rule ? "border-t border-[#333]" : ""}>
      <td className={`py-[3px] pr-2 ${strong ? "font-bold" : "font-semibold"}`}>{k}</td>
      <td className="py-[3px] pr-1">:</td>
      <td className={`py-[3px] text-right font-mono ${strong ? "font-bold" : ""}`}>{v}</td>
    </tr>
  );
}

function Th({ children, w, right }: { children?: React.ReactNode; w: string; right?: boolean }) {
  return (
    <th style={{ width: w }} className={`py-[3px] pr-1 text-[9px] font-bold ${right ? "text-right" : "text-left"}`}>
      {children}
    </th>
  );
}

/**
 * A4, multi-page, and byte-for-byte the IP bill's page setup - see
 * detailed-bill-sheet for why every rule in here is what it is. The two
 * documents come out of the same tray for the same stay and must sit on the
 * paper identically; a family holding both notices a 3mm difference before they
 * notice anything else.
 *
 * The one addition is `.paid-chip`.
 */
const CSS = (onStationery: boolean) => `
  .print-stage { --pr-primary: #0b5f55; --pr-ink: #111111; --pr-line: #b9c4c0; }
  .print-stage { background: #e8e6e1; min-height: 100vh; padding: 24px 12px 64px; }

  #print-sheet {
    width: 210mm;
    margin: 0 auto;
    background: #fff;
    color: var(--pr-ink);
    box-shadow: 0 8px 40px rgba(0,0,0,.18);
    padding: ${onStationery ? "40mm 13mm 46mm" : "10mm 10mm"};
    font-family: var(--font-sans, "Instrument Sans"), "Noto Sans Telugu", "Nirmala UI", Arial, sans-serif;
    font-size: 9.7px;
    line-height: 1.4;
  }
  #print-sheet .rule-strong { border-bottom: 2px solid var(--pr-primary); }
  #print-sheet table.doc { width: 100%; border-collapse: collapse; }
  #print-sheet table.doc > thead > tr > td,
  #print-sheet table.doc > tbody > tr > td { padding: 0; }

  /* PAID, ON THE LINE. Outlined in the page's own ink rather than filled in a
     colour: this sheet is photocopied and faxed, and a light green fill comes
     back as a grey smudge over the words it was meant to carry. */
  #print-sheet .paid-chip {
    display: inline-block;
    margin-left: 5px;
    padding: 0 3px;
    border: 1px solid var(--pr-ink);
    border-radius: 2px;
    font-size: 7px;
    font-weight: 700;
    letter-spacing: .04em;
    line-height: 1.5;
    vertical-align: 1px;
    white-space: nowrap;
  }

  @media print {
    html, body { background: #fff !important; margin: 0 !important; padding: 0 !important; }
    body * { visibility: hidden !important; }
    #print-sheet, #print-sheet * { visibility: visible !important; }
    .print-stage { background: #fff !important; padding: 0 !important; margin: 0 !important; min-height: 0 !important; }

    @page { size: A4 portrait; margin: ${onStationery ? "40mm 13mm 46mm" : "10mm"}; }

    #print-sheet {
      position: static !important;
      width: auto !important;
      min-height: 0 !important;
      margin: 0 !important;
      box-shadow: none !important;
      padding: 0 !important;
    }

    thead { display: table-header-group; }
    tr { break-inside: avoid; }
    .keep-together { break-inside: avoid; }
  }
`;

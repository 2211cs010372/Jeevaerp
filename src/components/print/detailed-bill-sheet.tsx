"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import JsBarcode from "jsbarcode";
import { api, ApiClientError } from "@/lib/api-client";
import { amountInWords } from "@/lib/amount-words";
import { BillHead, PrintToolbar, type HospitalInfo } from "@/components/print/stationery";

/**
 * IP FINAL BILL - the discharge bill for a stay.
 *
 * ONE DOCUMENT, TWO READERS, and that is the whole reason it looks the way it
 * does. A family gets it at the counter and checks it line by line against what
 * they remember; a TPA assessor gets it as a PDF attachment, reads it once
 * against a policy, and either pays or raises a query that costs the hospital
 * weeks. So the layout is not a house style choice - it copies the bill format
 * both of them already know how to read.
 *
 * What that format does, and why:
 *
 *   FOUR COLUMNS. Service type, quantity, rate, amount. Issue numbers, HSN
 *   codes and batch numbers all live on the counter's OWN invoice, which is the
 *   document anyone chasing a line opens; here they were a third of the width
 *   spent on things nobody reads off this sheet.
 *
 *   SUBTOTAL ON THE HEADING. Each section's total prints beside its name rather
 *   than under its lines, because a policy is written at that granularity - a
 *   room-rent cap applies to the hospital-services subtotal - and a reader
 *   deciding whether to read forty lines wants the number first.
 *
 *   DATES AS SUB-HEADINGS, for investigations and pharmacy only. Those read as
 *   a course of treatment: a repeat CRP or the third day's medicines are looked
 *   for by day. Ward and consultation are one rate over the stay, so their date
 *   sits inline instead of putting a heading above every row.
 *
 *   PAYMENT DETAILS, ITEMISED. Deposits and counter payments as rows, not one
 *   number. A family that paid three times expects to see three lines.
 *
 *   A4, NOT A5. Forty line items and five subtotals do not fit on a half-sheet.
 *
 *   BOTH BARCODES. IP number and bill number. The assessor's file and the
 *   hospital's file are reconciled on those two numbers, by hand, months later.
 *
 * It prints through the browser's own "Save as PDF", which is how every other
 * sheet here produces a PDF: no server-side renderer to keep alive, and what the
 * desk sees on screen is byte-for-byte what the insurer receives.
 */

interface BillLine {
  date: string | null; issueNo: string | null; code: string | null;
  description: string; batchNo: string | null; expiry: string | null;
  rate: string; qty: number; amount: string;
  /** Nothing has invoiced this yet. Printed, marked, and counted in the total. */
  draft?: boolean;
  /** False when the amount is not knowable yet - prints a dash, adds nothing. */
  priced?: boolean;
  // `paidStatus` is on the wire and deliberately not read here - see the note
  // at the description cell. Paid-vs-due is answered once in the totals block;
  // per-line it belongs on the stay screen's running tab, not on this sheet.
}
interface BillGroup {
  title: string; lines: BillLine[]; total: string;
  /** Break this section into date sub-headings (investigations, pharmacy). */
  byDate: boolean;
}
/** One row of the Payment Details table. */
interface BillPayment { invoiceNo: string; date: string; mode: string; amount: string }
/** One of the other counters' bills whose lines appear above, by number. */
interface BillSource {
  receiptNo: string; source: string; date: string;
  total: string; paid: string; status: "PAID" | "PART" | "DUE";
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
  };
  sourceType: string;
  insurer: string | null;
  policyNo: string | null;
  groups: BillGroup[];
  gross: string; discount: string; gst: string; netBill: string; advance: string; netPayable: string;
  draftTotal: string;
  draftUnpricedCount: number;
  counterPaid: string;
  payments: BillPayment[];
  sourceBills: BillSource[];
}

const money = (v: string | number) =>
  Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const GENDER: Record<string, string> = { MALE: "MALE", FEMALE: "FEMALE", OTHER: "OTHER" };
/**
 * Some doctors are stored with the honorific already on the name and some are
 * not, so prefixing unconditionally printed "Dr. Dr. Aditya Bellala" on a bill
 * going to an insurer. Add it only when it is missing.
 */
const withDr = (name: string) => (/^dr\.?\s/i.test(name.trim()) ? name.trim() : `Dr. ${name.trim()}`);
/**
 * dd-mm-yyyy.
 *
 * Assembled from the parts rather than left to `toLocaleDateString`, which
 * returns dd/mm/yyyy for en-IN. The slashes are the locale's and there is no
 * option to change the separator - so a format the hospital asked for cannot be
 * expressed through it at all.
 *
 * Doing it by hand also PINS the output. Intl formatting varies with the ICU
 * build underneath, so the same bill could print one way on the desk's machine
 * and another on the server's; on a document a TPA files in another city, the
 * date is the last field that should be allowed to drift.
 */
const d = (iso: string | null) => {
  if (!iso) return "";
  const x = new Date(iso);
  return `${String(x.getDate()).padStart(2, "0")}-${String(x.getMonth() + 1).padStart(2, "0")}-${x.getFullYear()}`;
};
/** dd-mm-yyyy, h:mm AM/PM - the same date, with the clock time after it. */
const dt = (iso: string | null) => {
  if (!iso) return "-";
  const x = new Date(iso);
  const h = x.getHours();
  const clock = `${h % 12 === 0 ? 12 : h % 12}:${String(x.getMinutes()).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
  return `${d(iso)}, ${clock}`;
};

const SOURCE_LABEL: Record<string, string> = {
  PHARMACY: "Pharmacy", LAB: "Laboratory", CONSULTATION: "OP Consultation", OTHER: "Services",
};
const MODE_LABEL: Record<string, string> = {
  CASH: "Cash", UPI: "UPI", CARD: "Card", NETBANKING: "Net banking",
  INSURANCE: "Insurance", OTHER: "Other",
};

/**
 * Lines bucketed under their own date, in the order the days happened.
 *
 * A Map preserves insertion order, and the lines arrive oldest-first from the
 * service, so the days come out chronological without a second sort. Lines with
 * no date at all (a ward charge that was never stamped) collect under "" and
 * print with no heading rather than under a fabricated one.
 */
function groupLinesByDate(lines: BillLine[]): [string, BillLine[]][] {
  const byDay = new Map<string, BillLine[]>();
  for (const l of lines) {
    const day = d(l.date);
    byDay.set(day, [...(byDay.get(day) ?? []), l]);
  }
  // Undated lines lead: they belong to the stay as a whole, not to one day.
  return [...byDay.entries()].sort(([a], [z]) => (a === "" ? -1 : z === "" ? 1 : 0));
}

/**
 * One printed line.
 *
 * `withDate` puts the date in front of the description, which is how a section
 * that is NOT sub-headed by day still says when each thing happened.
 * `indent` is for lines that already sit under a date heading.
 */
function BillRow({ l, withDate, indent }: { l: BillLine; withDate?: boolean; indent?: boolean }) {
  return (
    <tr>
      <td className={`py-[3px] pr-1 ${indent ? "pl-3" : ""}`}>
        {withDate && l.date && <span className="font-mono text-[8.5px]">{dt(l.date)} - </span>}
        {l.description}
        {/* PER-LINE PAID/DUE MARKERS ARE DELIBERATELY NOT HERE. They were, and
            they made a settled bill read as an argument about who owed what -
            on a document a family takes away and an insurer files. What has
            been collected is a MONEY question, answered once in the totals and
            itemised in Payment Details. The stay screen's running tab is where
            a desk needs it line by line, and that is where it still is. */}
        {l.draft && (
          <span className="ml-1.5 rounded-sm border border-[#8a6414] px-[3px] py-px align-middle text-[7px] font-bold uppercase tracking-wide text-[#8a6414]">
            not yet billed
          </span>
        )}
      </td>
      <td className="py-[3px] pr-1 text-right font-mono">{l.qty}</td>
      {/* An unpriced draft prints a dash, never 0.00 - a zero in a money column
          reads as "free", which is a different claim from "not priced yet". */}
      <td className="py-[3px] pr-1 text-right font-mono">{l.draft && !l.priced ? "—" : money(l.rate)}</td>
      <td className="py-[3px] text-right font-mono">{l.draft && !l.priced ? "—" : `₹${money(l.amount)}`}</td>
    </tr>
  );
}

export function DetailedBillSheet() {
  const { admissionId } = useParams<{ admissionId: string }>();
  const [b, setB] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  /**
   * Printing onto the hospital's own pre-printed pad, the same one the OPD
   * sheet uses. Defaults ON because that is what is in the tray - a claim bill
   * on blank paper is the exception here, not the rule.
   */
  const [onStationery, setOnStationery] = useState(true);
  const ipBar = useRef<SVGSVGElement>(null);
  const billBar = useRef<SVGSVGElement>(null);

  useEffect(() => {
    api.get<Data>(`/insurance/admissions/${admissionId}/bill`)
      .then(setB)
      .catch((e) => setError(e instanceof ApiClientError ? e.message : "Couldn't load the bill."));
  }, [admissionId]);

  // The two numbers the claim gets reconciled on, machine-readable. Drawn after
  // the data lands, because JsBarcode writes into a node that must already exist.
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

  return (
    <div className="print-stage">
      <style>{CSS(onStationery)}</style>
      <div className="mx-auto mb-2 flex w-full max-w-[210mm] items-center justify-end print:hidden">
        <label className="flex items-center gap-2 text-[13px] text-[#3a4744]">
          <input type="checkbox" checked={onStationery} onChange={(e) => setOnStationery(e.target.checked)} />
          Printing on the hospital&apos;s pre-printed sheet
        </label>
      </div>
      <PrintToolbar title={`Detailed bill · ${b.admission.ipNumber}`} />

      <div id="print-sheet">
        {/* ── THE DOCUMENT, AS ONE TABLE ──
            A claim bill runs to three pages as often as one, and page two of a
            bill carrying no patient name and no bill number is unattributable
            the moment a TPA separates it from page one - which is exactly what
            happens inside their file.
            A `thead` is the one thing browsers reliably repeat on every printed
            page, so the masthead and the patient box live in one. Everything
            below flows normally and breaks wherever it needs to. */}
        <table className="doc">
          <thead>
            <tr>
              <td className="pb-1">
                {/* On pre-printed paper the letterhead is already on the sheet,
                    and the page margins below reserve the band it occupies -
                    printing our own on top of it would strike through theirs. */}
                {!onStationery && <BillHead hospital={b.hospital} />}
                <div className="mt-1 text-center text-[13px] font-bold tracking-wide">
                  IP FINAL BILL
                  {/* Said on the sheet, not just in the UI. A bill for a stay
                      that is still running WILL be filed by somebody as if it
                      were final. */}
                  {b.provisional && (
                    <span className="ml-2 rounded border border-[#8a5a1a] px-1.5 py-[1px] text-[8.5px] font-bold uppercase tracking-wide text-[#8a5a1a]">
                      Provisional · stay in progress
                    </span>
                  )}
                </div>

                {/* ── WHO, AND WHICH BILL ── two columns of label/value pairs,
            read across rather than down: MR against Reg No, admit against
            discharge. Kept together so it never splits across a page - a
            continuation page whose header is on the previous sheet is the
            single easiest way to lose a page of a claim. */}
                <div className="keep-together mt-2 grid grid-cols-2 gap-x-4 border border-[#333] p-1.5">
                  <F k="MR Number" v={b.patient.displayId} />
                  <F k="Patient Reg.No." v={b.admission.ipNumber} />
                  <F k="Patient Name" v={b.patient.fullName.toUpperCase()} strong />
                  <F k="Phone" v={b.patient.phone} />
                  <F k="Age / Gender" v={`${b.patient.age != null ? `${b.patient.age}Y` : "-"} / ${GENDER[b.patient.gender ?? ""] ?? "-"}`} />
                  <F k="Room Info" v={b.admission.roomInfo} />
                  <F k="Admit Date" v={dt(b.admission.admittedAt)} />
                  <F k="Date of Discharge" v={b.admission.dischargedAt ? dt(b.admission.dischargedAt) : "-"} />
                  <F k="Bill No" v={b.billNo} strong />
                  <F k="Discharge Type" v={b.admission.dischargeType} />
                  <F k="Source Type" v={b.sourceType} />
                </div>

                {/* ── DOCTOR INFORMATION ── who treated, under what letters. An
            assessor checks the specialisation against the diagnosis. */}
                <div className="keep-together mt-1.5 border border-[#333]">
                  <div className="border-b border-[#333] bg-[#eef2f1] px-1.5 py-[3px] text-[9.5px] font-bold uppercase">
                    Doctor Information
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 p-1.5">
                    <F k="Consultant Doctor" v={withDr(b.admission.doctor)} strong />
                    <F k="Department" v={b.admission.department} />
                    <F k="Specialization" v={b.admission.qualification || b.admission.specialization || "-"} />
                  </div>
                </div>

                <div className="mt-1.5 text-[9.5px] font-bold uppercase">Payment Information</div>
              </td>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>

                {/* ── THE LINES ── its own thead, which repeats too, so a continuation
            page carries the column headings rather than nine bare numbers. */}
                <table className="mt-1 w-full border-collapse text-[9.5px]">
                  <thead>
                    {/* FOUR COLUMNS. Date, issue number, HSN code and batch each
                had one of their own; between them they took a third of the
                width to carry things that are all on the counter's OWN invoice,
                which is the document anyone chasing a line actually opens. The
                bill answers what was done, how much of it, at what rate. The
                date survives - inline on the line, or as a sub-heading. */}
                    <tr className="border-b border-t border-[#333]">
                      <Th w="60%">Service Type</Th>
                      <Th w="10%" right>Quantity</Th>
                      <Th w="13%" right>Rate</Th>
                      <Th w="17%" right>Amount(₹)</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* A keyed Fragment, not a bare one: each group emits a heading, its
                lines and a subtotal as siblings, and only the wrapper can carry
                the key that keeps them associated across a re-render. */}
                    {b.groups.map((g) => (
                      <Fragment key={g.title}>
                        {/* THE SUBTOTAL RIDES ON THE HEADING, not on a trailing
                    row. A reader deciding whether a section is worth reading
                    line by line - a room-rent cap against the ward total, say -
                    gets the number before the forty lines rather than after
                    them, and on a bill that breaks across pages the heading is
                    the part that stays with the section. */}
                        <tr className="border-t border-[#333]">
                          <td colSpan={3} className="pb-[3px] pt-2 text-[9.5px] font-bold uppercase">{g.title}</td>
                          <td className="pb-[3px] pt-2 text-right font-mono text-[9.5px] font-bold">₹{money(g.total)}</td>
                        </tr>

                        {g.byDate
                          ? // Investigations and pharmacy read as a course of
                          // treatment: the date is the heading and the items
                          // sit under it, which is how a repeat CRP or a third
                          // day's medicines are actually looked for.
                          groupLinesByDate(g.lines).map(([day, lines]) => (
                            <Fragment key={`${g.title}-${day}`}>
                              {day && (
                                <tr>
                                  <td colSpan={4} className="pb-[2px] pt-[5px] font-mono text-[9px] font-semibold">{day}</td>
                                </tr>
                              )}
                              {lines.map((l, i) => <BillRow key={`${g.title}-${day}-${i}`} l={l} indent />)}
                            </Fragment>
                          ))
                          : // Ward, nursing and consultation are one rate applied
                          // over the stay. A date heading above each would be a
                          // heading per row, so the date goes on the line.
                          g.lines.map((l, i) => <BillRow key={`${g.title}-${i}`} l={l} withDate />)}
                      </Fragment>
                    ))}
                  </tbody>
                </table>

                {/* ── BILLS INCLUDED ── the other counters' invoices whose lines
            are above, by number.

            The four-column layout dropped the per-line "Issue No", which is
            right - a receipt number repeated on forty rows is noise. But losing
            it entirely left a bill that quoted a pharmacy's charges without ever
            naming the pharmacy's invoice, so a family querying one could not say
            which document they meant and the desk could not find it. Listed once
            here, each bill is askable-for and printable. */}
                {b.sourceBills.length > 0 && (
                  <div className="keep-together mt-3">
                    <div className="text-[9.5px] font-bold uppercase">Bills included in this statement</div>
                    <table className="mt-1 w-full border-collapse text-[9.5px]">
                      <thead>
                        <tr className="border-b border-t border-[#333]">
                          <Th w="28%">Invoice No</Th>
                          <Th w="24%">Date &amp; time</Th>
                          <Th w="18%">Counter</Th>
                          <Th w="14%">Status</Th>
                          <Th w="16%" right>Amount(₹)</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {b.sourceBills.map((x) => (
                          <tr key={x.receiptNo}>
                            <td className="py-[3px] pr-1 font-mono text-[8.5px]">{x.receiptNo}</td>
                            <td className="py-[3px] pr-1 font-mono text-[8.5px]">{dt(x.date)}</td>
                            <td className="py-[3px] pr-1">{SOURCE_LABEL[x.source] ?? x.source}</td>
                            <td className="py-[3px] pr-1 text-[8.5px] font-semibold uppercase">
                              {x.status === "PAID" ? "Paid" : x.status === "PART" ? "Part paid" : "Due"}
                            </td>
                            <td className="py-[3px] text-right font-mono">₹{money(x.total)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* ── PAYMENT DETAILS ── every rupee already received against
            this stay. The totals block can only say how much; this says when,
            in what, and against which receipt - the difference between a bill
            a family can check and one they have to take on trust. */}
                {b.payments.length > 0 && (
                  <div className="keep-together mt-3">
                    <div className="text-[9.5px] font-bold uppercase">Payment Details</div>
                    <table className="mt-1 w-full border-collapse text-[9.5px]">
                      <thead>
                        <tr className="border-b border-t border-[#333]">
                          <Th w="8%">S.NO</Th>
                          <Th w="30%">Invoice No</Th>
                          <Th w="26%">Date &amp; time</Th>
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

                {/* ── THE MONEY ── kept whole, and on the right where an assessor's eye
            goes first. */}
                <div className="keep-together mt-4 flex items-start justify-between gap-8">
                  <div className="min-w-0 flex-1">
                    <div className="flex gap-2 text-[9.5px]">
                      <span className="w-[92px] shrink-0 font-semibold">Rupees in words</span>
                      <span>: <span className="font-semibold uppercase">{amountInWords(b.netPayable)}</span></span>
                    </div>
                    <div className="mt-6">
                      <div className="w-[190px] border-b border-[#333]" />
                      <div className="mt-1 text-[9px] font-bold">Patient/Attendant Signatory</div>
                    </div>
                  </div>

                  <table className="w-[250px] text-[10px]">
                    <tbody>
                      <T k="Total" v={money(b.gross)} />
                      {/* Called out INSIDE the money block rather than as a footnote.
                  The figure above already contains it, and a reader who takes
                  the Total as settled needs to meet the caveat in the same
                  glance - not three inches lower in small print. */}
                      {Number(b.draftTotal) > 0 && (
                        <T k="…of which not yet billed" v={money(b.draftTotal)} />
                      )}
                      <T k="Discount" v={money(b.discount)} />
                      {Number(b.gst) > 0 && <T k="Total GST" v={money(b.gst)} />}
                      <T k="Net Amount" v={money(b.netBill)} rule />
                      <T k="Advance Paid" v={money(b.advance)} />
                      {/* Money the pharmacy and lab windows already took on bills that
                  are listed above. Without this row the sheet adds those bills
                  into its total and then asks for them a second time. */}
                      {Number(b.counterPaid) > 0 && (
                        <T k="Paid at Counter" v={money(b.counterPaid)} />
                      )}
                      <T k="Balance Amount" v={money(b.netPayable)} rule strong />
                    </tbody>
                  </table>
                </div>

                {/* ── THE TWO NUMBERS, machine-readable ── */}
                <div className="keep-together mt-6 flex items-end justify-between gap-8">
                  <div>
                    <svg ref={ipBar} />
                    <div className="text-[8.5px] font-semibold">( IP No )</div>
                  </div>
                  <div className="text-[9px]">
                    <div className="flex gap-2"><span className="w-[82px] font-semibold">Bill date &amp; Time</span><span>: {dt(b.billedAt)}</span></div>
                    <div className="flex gap-2"><span className="w-[82px] font-semibold">Print Date &amp; Time</span><span>: {dt(new Date().toISOString())}</span></div>
                  </div>

                </div>

                {/* SAID ON THE SHEET, because the sheet is what leaves the building.
            Whoever reads this - a family at the counter, a TPA assessor weeks
            later - is entitled to know that part of the total is not yet an
            invoice, and how much. Kept above the standard footer so it is not
            mistaken for boilerplate. */}
                {Number(b.draftTotal) > 0 && (
                  <div className="keep-together mt-4 border border-[#8a6414] bg-[#fdf8ec] px-3 py-2 text-[8.5px] leading-relaxed text-[#8a6414]">
                    <b className="uppercase">Includes items not yet billed.</b>{" "}
                    Lines marked <i>not yet billed</i> total <b>{money(b.draftTotal)}</b> and are already counted in
                    the figures above. They are medicines and investigations raised against this stay that the
                    pharmacy or the laboratory has not yet invoiced.
                    {b.draftUnpricedCount > 0 && (
                      <>
                        {" "}
                        A further <b>{b.draftUnpricedCount}</b>{" "}
                        {b.draftUnpricedCount === 1 ? "item is" : "items are"} shown with a dash: the price is set
                        when the pharmacy dispenses the batch, so {b.draftUnpricedCount === 1 ? "it is" : "they are"} not
                        in the total and will be added when billed.
                      </>
                    )}
                  </div>
                )}

                <div className="mt-4 border-t border-[#333] pt-1 text-center text-[8.5px] text-[#57655f]">
                  {b.provisional
                    ? "Provisional bill for pre-authorisation. The final bill is raised at discharge."
                    : "Computer-generated bill. Submitted for insurance settlement."}
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** One "Label : value" row inside the header box. */
function F({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className="flex gap-1 py-[1.5px] text-[9.5px] leading-tight">
      <span className="w-[104px] shrink-0 font-semibold">{k}</span>
      <span className="shrink-0">:</span>
      <span className={strong ? "font-bold" : ""}>{v}</span>
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
 * A4, and DELIBERATELY MULTI-PAGE - see the note at the top. Everything here
 * exists so a bill that outgrows one sheet stays readable on the next.
 *
 * THE PAGE MARGINS DO THE RESERVING. On the hospital's pre-printed pad the
 * letterhead is already on the paper, top and bottom. `@page margin` applies to
 * EVERY page, so page three keeps clear of the printed letterhead exactly as
 * page one does. The other print profiles in this app pin their sheet with
 * `position: absolute`, which reserves those bands beautifully and confines the
 * document to a single page - correct for a one-page receipt, fatal here.
 *
 * NOTHING IS POSITIONED. No absolute pinning and no fixed height, so content
 * flows and the browser breaks it where it runs out of paper.
 *
 * `thead` REPEATS. Both of them - the document header carrying the patient and
 * the bill number, and the line table's column headings.
 */
const CSS = (onStationery: boolean) => `
  .print-stage { --pr-primary: #0b5f55; --pr-ink: #17211e; --pr-line: #b9c4c0; }
  .print-stage { background: #e8e6e1; min-height: 100vh; padding: 24px 12px 64px; }

  #print-sheet {
    width: 210mm;
    margin: 0 auto;
    background: #fff;
    color: var(--pr-ink);
    box-shadow: 0 8px 40px rgba(0,0,0,.18);
    /* On screen the padding stands in for the page margins, so the preview is
       laid out like the paper. Measurements match STATIONERY_PRINT_CSS. */
    padding: ${onStationery ? "40mm 13mm 46mm" : "10mm 10mm"};
    font-family: var(--font-sans, "Instrument Sans"), "Noto Sans Telugu", "Nirmala UI", Arial, sans-serif;
    font-size: 9.7px;
    line-height: 1.4;
  }
  #print-sheet .rule-strong { border-bottom: 2px solid var(--pr-primary); }
  /* The document wrapper is a table only so its header can repeat; it must not
     look like one. */
  #print-sheet table.doc { width: 100%; border-collapse: collapse; }
  #print-sheet table.doc > thead > tr > td,
  #print-sheet table.doc > tbody > tr > td { padding: 0; }

  @media print {
    html, body { background: #fff !important; margin: 0 !important; padding: 0 !important; }
    body * { visibility: hidden !important; }
    #print-sheet, #print-sheet * { visibility: visible !important; }
    .print-stage { background: #fff !important; padding: 0 !important; margin: 0 !important; min-height: 0 !important; }

    /* Per-page bands. On the pre-printed pad these clear the letterhead and the
       printed footer on every sheet, not just the first. */
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

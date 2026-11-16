"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import JsBarcode from "jsbarcode";
import { api, ApiClientError } from "@/lib/api-client";
import { amountInWords } from "@/lib/amount-words";
import { BillHead, PrintToolbar, type HospitalInfo } from "@/components/print/stationery";

/**
 * IP BILL - the itemised bill for a stay, printed mid-stay or at discharge.
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
  /**
   * Nothing has invoiced this yet. Printed and counted in the total like any
   * other line, and NOT marked as different - see the note at the description
   * cell. Still read here for one thing only: an unpriced draft prints a dash.
   */
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
    registrationNo: string | null;
  };
  sourceType: string;
  insurer: string | null;
  policyNo: string | null;
  groups: BillGroup[];
  gross: string; discount: string; gst: string; roundOff: string; netBill: string; advance: string; netPayable: string;
  // `draftTotal` and `draftUnpricedCount` are on the wire and deliberately not
  // read here. They split the Total into billed and not-yet-billed, which is
  // the hospital's own paperwork rather than anything the family or the
  // assessor can act on. Kept on the DTO because the service computes them
  // anyway and dropping them would be an API change for a cosmetic one.
  draftTotal: string;
  draftUnpricedCount: number;
  counterPaid: string;
  payments: BillPayment[];
  sourceBills: BillSource[];
}

/**
 * THE RUPEE SIGN, SIZED TO THE DIGITS. Neither font on this sheet (DM Mono for
 * money, Instrument Sans for text) carries a ₹, so the browser borrowed one from
 * a system font and drew it visibly taller and heavier than the figure beside
 * it. Its own span pins it to the digits' size - see .rs in the sheet CSS.
 */
const Rs = () => <span className="rs">₹</span>;

const money = (v: string | number) =>
  Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const GENDER: Record<string, string> = { MALE: "MALE", FEMALE: "FEMALE", OTHER: "OTHER" };

const pad = (n: number) => String(n).padStart(2, "0");
/** A Date as `<input type="datetime-local">` wants it: local wall clock. */
const toLocalInput = (d: Date): string =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
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
      {/* ── THE LINE ITSELF IS SEMIBOLD, SAME AS THE COUNTER'S OWN BILL ──
          These four cells are what the sheet exists to carry, and they were set
          at 400 against section headings at 700 and a body size of 9.7px - so
          the ONE part of the page a family reads line by line, and an assessor
          checks against a policy, was the lightest thing on it. Semibold is the
          weight the pharmacy invoice now sets its items in, and the two
          documents are read side by side for the same stay. */}
      <td className={`py-[3px] pr-1 font-semibold ${indent ? "pl-3" : ""}`}>
        {withDate && l.date && <span className="font-mono text-[10.5px]">{dt(l.date)} - </span>}
        {l.description}
        {/* NO PER-LINE STATUS MARKERS AT ALL - neither paid/due nor
            billed/not-yet-billed.

            The paid/due pair went first: they made a settled bill read as an
            argument about who owed what, on a document a family takes away and
            an insurer files. What has been collected is a MONEY question,
            answered once in the totals and itemised in Payment Details.

            "Not yet billed" has now gone the same way, for the same reason. It
            marked an internal distinction - whether a counter had got round to
            raising its own invoice - on the one sheet whose readers cannot act
            on it. A family reading it asked whether the line was really theirs
            to pay; an assessor read a hedge into a figure the hospital was
            nonetheless asking for. The line is on the bill, it is in the total,
            and it is charged: that is the whole statement, and the badge only
            ever undermined it.

            The stay screen's running tab is where a desk needs any of this line
            by line, and that is where it still is. */}
      </td>
      <td className="py-[3px] pr-1 text-right font-mono font-medium">{l.qty}</td>
      {/* An unpriced draft prints a dash, never 0.00 - a zero in a money column
          reads as "free", which is a different claim from "not priced yet". */}
      <td className="py-[3px] pr-1 text-right font-mono font-medium">{l.draft && !l.priced ? "—" : money(l.rate)}</td>
      <td className="py-[3px] text-right font-mono font-medium">{l.draft && !l.priced ? "—" : <><Rs />{money(l.amount)}</>}</td>
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
  /**
   * THE DISCHARGE DATE ON THIS BILL, WHEN THE PORTAL HAS NOT STAMPED ONE.
   *
   * Same box, same rule and the same reason as the discharge summary's: the
   * family leaves before the desk closes the stay, and a bill that prints a dash
   * where the discharge date belongs is one a TPA sends back. Typed here it
   * changes the PAPER only - nothing is saved, the stay is not closed, the bed
   * is not freed, no invoice is raised, and not one figure on this bill moves.
   *
   * Empty is exactly the old behaviour: the recorded date, or a dash.
   */
  const [pickedDischarge, setPickedDischarge] = useState("");
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

  // Only a date this stay could have - nobody leaves before they arrive.
  const pickedAt = pickedDischarge ? new Date(pickedDischarge) : null;
  const pickedBad = !!pickedAt && (Number.isNaN(pickedAt.getTime()) || pickedAt < new Date(b.admission.admittedAt));
  const pickedIso = pickedAt && !pickedBad ? pickedAt.toISOString() : null;

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
      <PrintToolbar title={`Detailed bill · ${b.admission.ipNumber}`} />

      <div id="print-sheet">
        {/* ── THE DOCUMENT, AS ONE TABLE ──
            A `thead` is the one thing browsers reliably repeat on every printed
            page. It now carries the masthead and the words IP BILL, and nothing
            else. Everything below flows normally and breaks where it needs to.

            THE PATIENT AND DOCTOR BOXES USED TO LIVE IN IT TOO. A claim bill
            runs to three pages as often as one, and re-printing both boxes at
            the head of every sheet spent a third of each page restating what
            page one already said. The hospital asked for them once, on page
            one, and that is where they are now - first thing in the body.

            What that bought, and what is now given back: a page separated from
            page one inside a TPA's file carries the hospital's name but not the
            patient's, the IP number or the bill number. If that ever bites, the
            answer is a slim one-line strip in the thead (name · IP no · bill
            no), not the whole block back. */}
        <table className="doc">
          <thead>
            <tr>
              <td className="pb-1">
                {/* On pre-printed paper the letterhead is already on the sheet,
                    and the page margins below reserve the band it occupies -
                    printing our own on top of it would strike through theirs. */}
                {!onStationery && <BillHead hospital={b.hospital} />}
                <div className="mt-1 text-center text-[13px] font-bold tracking-wide">
                  IP BILL
                </div>
              </td>
            </tr>
          </thead>

          <tbody>
            <tr>
              <td>
                {/* ── WHO, AND WHICH BILL ── two columns of label/value pairs,
            read across rather than down: MR against Reg No, admit against
            discharge. PAGE ONE ONLY - see the note above the table. Still kept
            together, so the box itself never splits across a page break. */}
                <div className="keep-together mt-2 grid grid-cols-2 gap-x-4 border border-[#333] p-1.5">
                  <F k="MR Number" v={b.patient.displayId} />
                  <F k="Patient Reg.No." v={b.admission.ipNumber} />
                  <F k="Patient Name" v={b.patient.fullName.toUpperCase()} strong />
                  <F k="Phone" v={b.patient.phone} />
                  <F k="Age / Gender" v={`${b.patient.age != null ? `${b.patient.age}Y` : "-"} / ${GENDER[b.patient.gender ?? ""] ?? "-"}`} />
                  <F k="Room Info" v={b.admission.roomInfo} />
                  <F k="Admit Date" v={dt(b.admission.admittedAt)} />
                  {/* A typed date wins over the recorded one - see `pickedDischarge`. */}
                  <F k="Date of Discharge" v={pickedIso ? dt(pickedIso) : b.admission.dischargedAt ? dt(b.admission.dischargedAt) : "-"} />
                  <F k="Bill No" v={b.billNo} strong />
                  {/* A bill carrying a discharge date must not print ADMITTED next
                      to it. The recorded status is still what wins wherever the
                      stay has actually been closed - including as LAMA or EXPIRED. */}
                  <F k="Discharge Type" v={pickedIso && b.admission.dischargeType === "ADMITTED" ? "DISCHARGED" : b.admission.dischargeType} />
                  <F k="Source Type" v={b.sourceType} />
                </div>

                {/* ── DOCTOR INFORMATION ── who treated, under what letters. An
            assessor checks the specialisation against the diagnosis. */}
                <div className="keep-together mt-1.5 border border-[#333]">
                  <div className="border-b border-[#333] bg-[#eef2f1] px-1.5 py-[3px] text-[11.5px] font-bold uppercase">
                    Doctor Information
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 p-1.5">
                    <F k="Consultant Doctor" v={withDr(b.admission.doctor)} strong />
                    <F k="Department" v={b.admission.department} />
                    <F k="Specialization" v={b.admission.qualification || b.admission.specialization || "-"} />
                    {/* A receipt for money taken from a patient carries the
                        council number of the doctor it was taken under. */}
                    <F k="Reg. No." v={b.admission.registrationNo || "-"} />
                  </div>
                </div>

                <div className="mt-1.5 text-[11.5px] font-bold uppercase">Payment Information</div>

                {/* ── THE LINES ── its own thead, which repeats too, so a continuation
            page carries the column headings rather than nine bare numbers. */}
                <table className="mt-1 w-full border-collapse text-[10.5px]">
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
                      <Th w="17%" right>Amount(<Rs />)</Th>
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
                          <td colSpan={3} className="pb-[3px] pt-2 text-[11.5px] font-semibold uppercase">{g.title}</td>
                          <td className="pb-[3px] pt-2 text-right font-mono text-[11.5px] font-semibold"><Rs />{money(g.total)}</td>
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
                                  <td colSpan={4} className="pb-[2px] pt-[5px] font-mono text-[11.5px] font-semibold">{day}</td>
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
            here, each bill is askable-for and printable.

            NO STATUS COLUMN. It said Paid / Part paid / Due against each
            pharmacy and lab bill, and a family reading down it counted the
            "Paid" rows and expected them off the total - which they already
            are, in Paid at Counter below. The same fact stated twice in two
            shapes reads as two facts. Paid-vs-due is answered once, in the
            totals block, where it settles what is owed today. */}
                {b.sourceBills.length > 0 && (
                  <div className="keep-together mt-3">
                    <div className="text-[11.5px] font-semibold uppercase">Bills included in this statement</div>
                    <table className="mt-1 w-full border-collapse text-[10.5px]">
                      <thead>
                        <tr className="border-b border-t text-[11.5px] border-[#333]">
                          <Th w="32%">Invoice No</Th>
                          <Th w="20%">Date</Th>
                          <Th w="22%">Counter</Th>
                          <Th w="20%" right>Amount(<Rs />)</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {b.sourceBills.map((x) => (
                          <tr key={x.receiptNo}>
                            <td className="py-[3px] pr-1 font-mono text-[10.5px]">{x.receiptNo}</td>
                            <td className="py-[3px] pr-1 font-mono text-[10.5px]">{dt(x.date)}</td>
                            <td className="py-[3px] pr-1">{SOURCE_LABEL[x.source] ?? x.source}</td>
                            <td className="py-[3px] text-right font-mono"><Rs />{money(x.total)}</td>
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
                    <div className="text-[11.5px] font-bold uppercase">Payment Details</div>
                    <table className="mt-1 w-full border-collapse text-[10.5px]">
                      <thead>
                        <tr className="border-b border-t border-[#333]">
                          <Th w="8%">S.NO</Th>
                          <Th w="30%">Invoice No</Th>
                          <Th w="20%">Date</Th>
                          <Th w="20%">Payment Mode</Th>
                          <Th w="16%" right>Amount(<Rs />)</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {b.payments.map((p, i) => (
                          <tr key={`${p.invoiceNo}-${i}`}>
                            <td className="py-[3px] pr-1 font-mono text-[10.5px]">{i + 1}</td>
                            <td className="py-[3px] pr-1 font-mono text-[10.5px]">{p.invoiceNo}</td>
                            <td className="py-[3px] pr-1 font-mono text-[10.5px]">{dt(p.date)}</td>
                            <td className="py-[3px] pr-1">{MODE_LABEL[p.mode] ?? p.mode}</td>
                            <td className="py-[3px] text-right font-mono"><Rs />{money(p.amount)}</td>
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
                    <div className="flex gap-2 text-[10.5px]">
                      <span className="w-[92px] shrink-0 font-semibold">Rupees in words</span>
                      <span>: <span className="font-semibold uppercase">{amountInWords(b.netBill)}</span></span>
                    </div>
                    <div className="mt-6">
                      <div className="w-[190px] border-b border-[#333]" />
                      <div className="mt-1 text-[10.5px] font-bold">Patient/Attendant Signatory</div>
                    </div>
                  </div>

                  <table className="w-[250px] text-[10.5px]">
                    <tbody>
                      <T k="Total Amount" v={money(b.gross)} />
                      <T k="Advance Paid" v={money(b.advance)} />
                      <T k="Discount" v={money(b.discount)} />
                      <T k="Balance Due" v={money(b.netPayable)} strong />

                      {/* NO "…of which not yet billed" SPLIT. The Total is the
                  Total. Carving out the part no counter had invoiced yet
                  described the hospital's paperwork, not the family's debt -
                  and a caveat sitting inside the money block reads as a figure
                  that might come off, which it never does. */}
                      {Number(b.gst) > 0 && <T k="Total GST" v={money(b.gst)} />}
                      {/* The bills are whole rupees (lib/money-round); their round-offs,
                          summed, are what closes lines-plus-tax onto what was billed. */}
                      {Number(b.roundOff) !== 0 && <T k="Round Off" v={money(b.roundOff)} />}
                      <T k="Net Amount" v={money(b.netBill)} rule strong />

                      {/* Money already taken at a counter: the pharmacy and lab
                  windows on the bills listed above, and the discharge desk on
                  the stay's own bill. Without this row the sheet adds those
                  bills into its total and then asks for them a second time. */}
                      {/* {Number(b.counterPaid) > 0 && (
                        <T k="Paid at Counter" v={money(b.counterPaid)} />
                      )} */}

                      {/* Balance amount */}
                      {/* <T k="Balance Amount" v={money(b.netPayable)} rule strong /> */}
                    </tbody>
                  </table>
                </div>

                {/* ── THE TWO NUMBERS, machine-readable ── */}
                <div className="keep-together mt-6 flex items-end justify-between gap-8">
                  <div>
                    <svg ref={ipBar} />
                    <div className="text-[10.5px] font-semibold">( IP No )</div>
                  </div>
                  <div className="text-[10.5px]">
                    <div className="flex gap-2"><span className="w-[82px] font-semibold">Bill date</span><span>: {dt(b.billedAt)}</span></div>
                    <div className="flex gap-2"><span className="w-[82px] font-semibold">Print Date</span><span>: {dt(new Date().toISOString())}</span></div>
                  </div>

                </div>

                {/* NO "INCLUDES ITEMS NOT YET BILLED" BOX. It existed to explain
            the badges and the totals split above, and both are gone - an amber
            warning box left behind on its own would be a caveat about markings
            the sheet no longer carries.

            A line that genuinely has no price yet still prints a dash rather
            than a figure (see BillRow), which is the honest form of the same
            fact and needs no paragraph under it. */}

                <div className="mt-4 border-t border-[#333] pt-1 text-center text-[8.5px] text-[#57655f]">
                  Computer-generated bill. Submitted for insurance settlement.
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
 * One "Label : value" row inside the header box - the patient block and the
 * doctor block are both built out of these.
 *
 * THE VALUE IS SEMIBOLD, THE LABEL ALREADY WAS. That pairing was the wrong way
 * round for what a reader does with this box: the labels are furniture, the same
 * fourteen words on every bill the hospital has ever issued, while the values -
 * the MR number, the room, the admit date, the consultant's registration number
 * - are the fields an assessor checks against a policy and a family checks
 * against their own paperwork. Setting the constant half at 600 and the
 * variable half at 400 made the page emphasise the part nobody reads.
 *
 * `strong` stays a step above at 700, so the three fields that identify the
 * document at a glance - patient name, bill number, consultant - still lift off
 * the block rather than flattening into it.
 */
function F({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className="flex gap-1 py-[1.5px] text-[10.5px] leading-tight">
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
    <th style={{ width: w }} className={`py-[3px] pr-1 text-[11.5px] font-bold ${right ? "text-right" : "text-left"}`}>
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
  /* INK IS NEUTRAL, AND IT IS THE SAME INK THE COUNTER'S BILL USES.
     #17211e is a green-cast near-black - it was the house teal's darkest step,
     and on a screen it reads as black. Through the office laser printer it does
     not: a colour cast at that value renders as a washed grey a shade lighter
     than a true black, which is why this sheet's lines looked faint beside the
     pharmacy invoice for the same stay. #111111 is one colour, prints black on
     every device, and photocopies - which is what an insurer usually receives. */
  .print-stage { --pr-primary: #0b5f55; --pr-ink: #111111; --pr-line: #b9c4c0; }
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
    font-size: 10.5px;
    line-height: 1.4;
  }
  #print-sheet .rule-strong { border-bottom: 2px solid var(--pr-primary); }
  /* ₹ from a font that has it, scaled to the height of the amount's digits and
     at the digits' weight, so "₹1,186.50" reads as one figure. */
  #print-sheet .rs {
    font-family: "Noto Sans", "Segoe UI", Arial, sans-serif;
    font-size: 0.86em;
    font-weight: inherit;
    line-height: 1;
    margin-right: 0.08em;
  }
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

"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api, ApiClientError } from "@/lib/api-client";
import { BillHead, PrintToolbar, PRINT_CSS, type HospitalInfo } from "@/components/print/stationery";

/**
 * THE RUNNING TAB, ON PAPER.
 *
 * The stay screen shows what a patient has run up so far, and until now that
 * was a screen and nothing else. A ward round asking "what is this stay at?", a
 * family wanting to see the position before they agree to another day, an
 * auditor checking a charge that was later corrected - all of them had to stand
 * at the terminal, and none of them left with anything.
 *
 * THIS IS NOT A BILL, and the sheet says so in three places. No bill number, no
 * tax figures, nothing to sign. A stay in progress has no invoice, and a
 * document that looked like one would be filed by somebody as if it were - then
 * argued about at discharge when the real bill came out different, as it must,
 * because the tab is still running.
 *
 * What it IS: a dated, itemised statement of the position at one moment, with
 * the counter bills marked paid or due, so the paper can be checked against the
 * screen afterwards. The print time in the footer is the whole point of it.
 */

interface Charge {
  id: string; category: string; description: string; qty: number;
  unitPrice: string; amount: string; addedBy: string; createdAt: string;
  fromPharmacy: boolean;
}
interface CounterBill {
  id: string; receiptNo: string; source: string;
  total: string; paid: string; due: string;
  status: "PAID" | "PART" | "DUE"; payer: string; createdAt: string;
}
interface Advance { id: string; receiptNo: string | null; amount: string; mode: string; takenAt: string }
interface Data {
  hospital: (HospitalInfo & { logoDataUrl?: string | null }) | null;
  admission: {
    ipNumber: string; status: string; admittedAt: string; dischargedAt: string | null;
    wardName: string; bedNo: string; dailyCharge: string;
    payerType: string; insurer: string | null;
    patient: { displayId: string; fullName: string; age: number | null; gender: string | null; phone: string };
    doctor: { name: string; department: string };
  };
  days: number;
  /** One row per bed occupied. Two rows means they were transferred. */
  legs: { wardName: string; bedNo: string; dailyCharge: string; days: number; total: string; current: boolean }[];
  bedTotal: string; nurseTotal: string; nursePerDay: string;
  /** False since the per-day nursing fee was withdrawn - see ipd.service. */
  nursingApplies: boolean;
  chargesTotal: string; grandTotal: string;
  charges: Charge[];
  counterBills: CounterBill[];
  counterPaidTotal: string;
  advanceTotal: string;
  advances: Advance[];
  outstandingTotal: string;
  balance: string;
}

const money = (v: string | number) =>
  Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const GENDER: Record<string, string> = { MALE: "MALE", FEMALE: "FEMALE", OTHER: "OTHER" };
/** dd-mm-yyyy - the separator the hospital's bills use. See detailed-bill-sheet. */
const d = (iso: string | null) => {
  if (!iso) return "-";
  const x = new Date(iso);
  return `${String(x.getDate()).padStart(2, "0")}-${String(x.getMonth() + 1).padStart(2, "0")}-${x.getFullYear()}`;
};
const dt = (iso: string | null) => {
  if (!iso) return "-";
  const x = new Date(iso);
  const h = x.getHours();
  return `${d(iso)}, ${h % 12 === 0 ? 12 : h % 12}:${String(x.getMinutes()).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
};
const SOURCE: Record<string, string> = {
  PHARMACY: "Pharmacy dispense", LAB: "Laboratory tests", OTHER: "Other charges",
};
const MODE_LABEL: Record<string, string> = {
  CASH: "Cash", UPI: "UPI", CARD: "Card", NETBANKING: "Net banking", INSURANCE: "Insurance", OTHER: "Other",
};

function F({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className="flex gap-1.5 py-[1px] text-[9.5px]">
      <span className="w-[86px] shrink-0 font-semibold">{k}</span>
      <span className={strong ? "font-bold" : ""}>: {v}</span>
    </div>
  );
}
function Th({ children, w, right }: { children: React.ReactNode; w?: string; right?: boolean }) {
  return (
    <th style={w ? { width: w } : undefined}
      className={`border-b border-[#333] pb-[3px] text-[9px] font-bold uppercase ${right ? "text-right" : "text-left"}`}>
      {children}
    </th>
  );
}

export function RunningTabSheet() {
  const { admissionId } = useParams<{ admissionId: string }>();
  const [s, setS] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Frozen at first render, so every copy of one printing carries one time. */
  const [printedAt] = useState(() => new Date().toISOString());

  useEffect(() => {
    api.get<Data>(`/ipd/admissions/${admissionId}/tab-print`)
      .then(setS)
      .catch((e) => setError(e instanceof ApiClientError ? e.message : "Couldn't load the stay."));
  }, [admissionId]);

  if (error) return <div className="p-10 text-center text-[14px] text-[#8a3b2e]">{error}</div>;
  if (!s) return <div className="p-10 text-center text-[14px] text-[#5a6a66]">Loading…</div>;

  const a = s.admission;
  const running = a.status === "ADMITTED";

  return (
    <div className="print-stage">
      <style>{PRINT_CSS}</style>
      <PrintToolbar title={`Running tab · ${a.ipNumber}`} />

      <div id="print-sheet">
        <BillHead hospital={s.hospital} />

        <div className="mt-1 text-center text-[13px] font-bold tracking-wide">
          RUNNING TAB {running ? "— STAY IN PROGRESS" : "— AT DISCHARGE"}
        </div>
        {/* Said once, loudly, at the top. The second and third times are the
            band under the totals and the footer. */}
        <div className="mt-1 border border-[#8a5a1a] bg-[#fdf8ec] px-2 py-1 text-center text-[9px] font-bold uppercase tracking-wide text-[#8a5a1a]">
          Not a bill · not a receipt · position as at {dt(printedAt)}
        </div>

        <div className="mt-2 grid grid-cols-2 gap-x-4 border border-[#333] p-1.5">
          <F k="MR Number" v={a.patient.displayId} />
          <F k="Patient Reg.No." v={a.ipNumber} />
          <F k="Patient Name" v={a.patient.fullName.toUpperCase()} strong />
          <F k="Phone" v={a.patient.phone} />
          <F k="Age / Gender" v={`${a.patient.age != null ? `${a.patient.age}Y` : "-"} / ${GENDER[a.patient.gender ?? ""] ?? "-"}`} />
          <F k="Ward / Bed" v={`${a.wardName} / ${a.bedNo}`} />
          <F k="Admit Date" v={dt(a.admittedAt)} />
          <F k="Day of stay" v={`Day ${s.days}`} />
          <F k="Consultant" v={a.doctor.name} />
          <F k="Paying" v={a.payerType === "INSURANCE" ? `Insurance${a.insurer ? ` — ${a.insurer}` : ""}` : "Self-paying"} />
        </div>

        {/* ── WHAT THE STAY HAS RUN UP ── */}
        <div className="mt-2 text-[9.5px] font-bold uppercase">The running tab</div>
        <table className="mt-1 w-full border-collapse text-[9.5px]">
          <thead>
            <tr>
              <Th w="20%">Date &amp; time</Th>
              <Th w="40%">Item</Th>
              <Th w="8%" right>Qty</Th>
              <Th w="14%" right>Rate</Th>
              <Th w="18%" right>Amount(₹)</Th>
            </tr>
          </thead>
          <tbody>
            {/* Bed - and, on a stay old enough to carry it, nursing - are
                derived per day rather than stored as rows, and are printed
                first because they are what the stay costs before anybody adds
                anything to it. */}
            {/* ONE ROW PER BED, not one row for the stay.
                This printed a single line - the CURRENT ward, the whole stay's
                days, the admission rate - with the leg-summed total beside it.
                On a transferred patient that line contradicted itself: qty x
                rate did not make the amount, and the ward they had left was
                nowhere on the sheet. */}
            {(s.legs?.length ? s.legs : [{
              wardName: a.wardName, bedNo: a.bedNo, dailyCharge: a.dailyCharge,
              days: s.days, total: s.bedTotal, current: true,
            }]).map((l, i) => (
              <tr key={i}>
                <td className="py-[3px] pr-1 font-mono text-[8.5px]">{i === 0 ? dt(a.admittedAt) : ""}</td>
                <td className="py-[3px] pr-1">
                  Bed · {l.wardName} - {l.bedNo}
                  {/* A ward passed through on the day of a transfer bills
                      nothing - see splitStayDays. Saying so is better than a
                      bare 0 that reads as a mistake. */}
                  {l.days === 0 && <span className="ml-1 text-[8px] uppercase text-[#8a6414]">transferred same day, not charged</span>}
                </td>
                <td className="py-[3px] pr-1 text-right font-mono">{l.days}</td>
                <td className="py-[3px] pr-1 text-right font-mono">{money(l.dailyCharge)}</td>
                <td className="py-[3px] text-right font-mono">₹{money(l.total)}</td>
              </tr>
            ))}
            {/* The per-day nursing fee is withdrawn, so this row prints only
                on a stay that was actually billed for it. A family comparing
                this sheet against their invoice has to find the same lines on
                both. */}
            {s.nursingApplies && (
              <tr>
                <td className="py-[3px] pr-1 font-mono text-[8.5px]">{dt(a.admittedAt)}</td>
                <td className="py-[3px] pr-1">Nursing care</td>
                <td className="py-[3px] pr-1 text-right font-mono">{s.days}</td>
                <td className="py-[3px] pr-1 text-right font-mono">{money(s.nursePerDay)}</td>
                <td className="py-[3px] text-right font-mono">₹{money(s.nurseTotal)}</td>
              </tr>
            )}
            {s.charges.map((c) => (
              <tr key={c.id}>
                <td className="py-[3px] pr-1 font-mono text-[8.5px]">{dt(c.createdAt)}</td>
                <td className="py-[3px] pr-1">
                  {c.description}
                  <span className="ml-1 text-[8px] uppercase text-[#5a6a66]">· {c.addedBy}</span>
                </td>
                <td className="py-[3px] pr-1 text-right font-mono">{c.qty}</td>
                <td className="py-[3px] pr-1 text-right font-mono">{money(c.unitPrice)}</td>
                <td className="py-[3px] text-right font-mono">₹{money(c.amount)}</td>
              </tr>
            ))}
            <tr>
              <td colSpan={3} />
              <td className="border-t border-[#333] py-[3px] pr-1 text-right text-[9px] font-bold uppercase">Stay total</td>
              <td className="border-t border-[#333] py-[3px] text-right font-mono font-bold">₹{money(s.grandTotal)}</td>
            </tr>
          </tbody>
        </table>

        {/* ── THE OTHER COUNTERS ── every bill on the stay, settled or not. A
            paid one is listed precisely so the family can see it was counted. */}
        {s.counterBills.length > 0 && (
          <div className="keep-together mt-3">
            <div className="text-[9.5px] font-bold uppercase">Pharmacy &amp; laboratory bills</div>
            <table className="mt-1 w-full border-collapse text-[9.5px]">
              <thead>
                <tr>
                  <Th w="20%">Date &amp; time</Th>
                  <Th w="20%">Bill No</Th>
                  <Th w="26%">Counter</Th>
                  <Th w="14%">Status</Th>
                  <Th w="18%" right>Amount(₹)</Th>
                </tr>
              </thead>
              <tbody>
                {s.counterBills.map((b) => (
                  <tr key={b.id}>
                    <td className="py-[3px] pr-1 font-mono text-[8.5px]">{dt(b.createdAt)}</td>
                    <td className="py-[3px] pr-1 font-mono text-[8.5px]">{b.receiptNo}</td>
                    <td className="py-[3px] pr-1">{SOURCE[b.source] ?? b.source}</td>
                    <td className="py-[3px] pr-1 text-[8.5px] font-bold uppercase">
                      {b.payer === "INSURANCE" ? "On the claim" : b.status === "PART" ? "Part paid" : b.status === "PAID" ? "Paid" : "Due"}
                    </td>
                    <td className="py-[3px] text-right font-mono">₹{money(b.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ── MONEY IN ── */}
        {s.advances.length > 0 && (
          <div className="keep-together mt-3">
            <div className="text-[9.5px] font-bold uppercase">Advances received</div>
            <table className="mt-1 w-full border-collapse text-[9.5px]">
              <thead>
                <tr>
                  <Th w="20%">Date &amp; time</Th>
                  <Th w="32%">Receipt No</Th>
                  <Th w="30%">Mode</Th>
                  <Th w="18%" right>Amount(₹)</Th>
                </tr>
              </thead>
              <tbody>
                {s.advances.map((x) => (
                  <tr key={x.id}>
                    <td className="py-[3px] pr-1 font-mono text-[8.5px]">{dt(x.takenAt)}</td>
                    <td className="py-[3px] pr-1 font-mono text-[8.5px]">{x.receiptNo ?? "-"}</td>
                    <td className="py-[3px] pr-1">{MODE_LABEL[x.mode] ?? x.mode}</td>
                    <td className="py-[3px] text-right font-mono">₹{money(x.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ── WHERE IT STANDS ── */}
        <div className="keep-together mt-3 flex justify-end">
          <table className="w-[260px] text-[10px]">
            <tbody>
              <tr><td className="py-[2px]">Stay charges</td><td className="py-[2px] text-right font-mono">₹{money(s.grandTotal)}</td></tr>
              <tr><td className="py-[2px]">Advances received</td><td className="py-[2px] text-right font-mono">− ₹{money(s.advanceTotal)}</td></tr>
              <tr className="border-t border-[#333]">
                <td className="py-[3px] font-bold">Stay balance</td>
                <td className="py-[3px] text-right font-mono font-bold">₹{money(s.balance)}</td>
              </tr>
              {Number(s.outstandingTotal) > 0 && (
                <tr>
                  <td className="py-[2px] text-[#8a5a1a]">Counter bills still due</td>
                  <td className="py-[2px] text-right font-mono text-[#8a5a1a]">₹{money(s.outstandingTotal)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-3 border border-[#8a5a1a] bg-[#fdf8ec] px-2 py-1.5 text-[8.5px] leading-relaxed text-[#8a5a1a]">
          <b>This is a statement of position, not a bill.</b>{" "}
          {running
            ? "The stay is still running - bed and nursing accrue daily, and charges may be added or corrected before discharge. The final bill is raised at discharge and is the document to pay against."
            : "The final bill for this stay is the document to pay against; this sheet is a working record of what was on the tab."}
        </div>

        <div className="mt-4 flex items-end justify-between text-[9px]">
          <div>
            <div>Printed: {dt(printedAt)}</div>
            <div>Stay: {a.ipNumber} · {running ? `Day ${s.days}, still admitted` : `Discharged ${d(a.dischargedAt)}`}</div>
          </div>
          <div className="text-right">
            <div className="mb-1 h-8 w-[170px] border-b border-[#333]" />
            <div className="font-bold">Checked by</div>
          </div>
        </div>
      </div>
    </div>
  );
}

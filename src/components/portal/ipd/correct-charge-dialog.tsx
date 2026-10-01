"use client";

import { useState } from "react";
import { Icon } from "@/components/portal/ui/icons";
import { Spinner } from "@/components/portal/ui/form-atoms";
import { api, ApiClientError } from "@/lib/api-client";

/**
 * CORRECTING ONE LINE OF THE RUNNING TAB - what it cost, and when it happened.
 *
 * THE DATE was the reason this dialog exists. The printed tab has a "Date &
 * time" column and every line used to be stamped with the moment somebody keyed
 * it in, not the moment the treatment happened. Those are the same thing on a
 * quiet afternoon and nothing like it on a busy one: the ward writes on paper,
 * the desk enters four days of oxygen, rounds and dressings at one sitting, and
 * the sheet then hands the family a chronology that never happened. On a claim
 * it is worse - a date is the first thing a TPA matches against the case sheet.
 *
 * THE MONEY is here because the alternative was Remove and re-add, which throws
 * away who first raised the charge and when, on the one document most likely to
 * be argued over months later. The server has always allowed the reprice - it
 * exists for the tariff argument, where an insurer settles a dressing at its own
 * rate and the bill has to say what the policy will actually honour - but no
 * screen ever offered it.
 *
 * THE TWO ARE NOT THE SAME ACT, and the dialog says so. Moving a date changes
 * no figure and reaches no invoice, so a discharged stay's bill is left exactly
 * where it is. Moving the money on a discharged stay RE-ISSUES that bill, with
 * every rule in `updateInvoice` applying - the money-already-collected floor,
 * the filed IRN, `billEditingEnabled`. The banner says which of the two the desk
 * is about to do before they press Save.
 *
 * WHAT IT DOES NOT DO: it does not decide whether this desk may rewrite a bill.
 * A dialog that hid itself would be a permission made of CSS - see
 * CorrectStayDialog, which draws the same line for the same reason.
 */

const pad = (n: number) => String(n).padStart(2, "0");

/** A Date as `<input type="datetime-local">` wants it: local wall clock. */
function toLocalInput(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** dd-mm-yyyy, h:mm AM/PM - what the printed tab shows in the same column. */
export function chargeDateLabel(iso: string): string {
  const x = new Date(iso);
  if (Number.isNaN(x.getTime())) return "-";
  const h = x.getHours();
  return `${pad(x.getDate())}-${pad(x.getMonth() + 1)}-${x.getFullYear()}, ${h % 12 === 0 ? 12 : h % 12}:${pad(x.getMinutes())} ${h >= 12 ? "PM" : "AM"}`;
}

const money = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (s: string) => Number(s) || 0;

export interface EditableCharge {
  id: string;
  description: string;
  qty: number;
  unitPrice: string;
  gstRatePct: string;
  amount: string;
  /** ISO instant - AdmissionCharge.createdAt, as the sheet returns it. */
  createdAt: string;
}

export function CorrectChargeDialog({
  charge,
  admittedAt,
  dischargedAt,
  discharged,
  accent = "teal",
  onClose,
  onSaved,
}: {
  charge: EditableCharge;
  admittedAt: string;
  /** Null while the patient is still in a bed - then the date ceiling is now. */
  dischargedAt: string | null;
  /** The stay is closed, so its invoice exists and a reprice re-issues it. */
  discharged: boolean;
  accent?: "teal" | "blue";
  onClose: () => void;
  /** Reload the sheet: the tab is ordered by the date, so the row can move. */
  onSaved: (message: string) => void;
}) {
  // ── THE MINUTE TRAP ── see CorrectStayDialog, same trap for the same reason.
  //
  // `datetime-local` has no seconds. A line stamped 15:42:37 seeds the box as
  // 15:42, and saving that untouched would move the line thirty-seven seconds
  // and write a ward note saying somebody changed the bill. A box still equal to
  // what it was seeded with means the date was not edited, and is not sent.
  const seededDate = toLocalInput(new Date(charge.createdAt));
  const [date, setDate] = useState(seededDate);
  const [qty, setQty] = useState(String(charge.qty));
  const [rate, setRate] = useState(String(Number(charge.unitPrice)));
  const [gst, setGst] = useState(String(Number(charge.gstRatePct)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ring = accent === "blue" ? "var(--p-blue)" : "var(--p-teal)";

  const parsed = date ? new Date(date) : null;
  const dateValid = !!parsed && !Number.isNaN(parsed.getTime());
  const dateMoved = !!date && date !== seededDate;

  // Qty is a whole number of things done - half a dressing is not a charge.
  const qtyN = Math.floor(num(qty));
  const rateN = num(rate);
  const gstN = num(gst);
  // An EMPTY rate box is not ₹0. Somebody clearing it to retype the figure and
  // pressing Save would otherwise zero a real charge in one keystroke, and a
  // ₹0 line on a bill reads as a service the hospital gave away.
  const rateBlank = rate.trim() === "";
  const moneyValid = qtyN >= 1 && qtyN <= 999 && !rateBlank && rateN >= 0 && gstN >= 0 && gstN <= 28;
  const repriced =
    qtyN !== charge.qty || rateN !== Number(charge.unitPrice) || gstN !== Number(charge.gstRatePct);

  const was = Number(charge.amount);
  const now = qtyN * rateN;
  const delta = now - was;

  const changed = dateMoved || repriced;

  async function save() {
    if (!changed || !moneyValid || (dateMoved && !dateValid)) return;
    setBusy(true); setError(null);
    try {
      await api.patch(`/ipd/charges/${charge.id}`, {
        // Only what actually moved. A partial edit is the normal case here and
        // the server treats every field as optional.
        ...(dateMoved ? { chargedAt: parsed!.toISOString() } : {}),
        ...(qtyN !== charge.qty ? { qty: qtyN } : {}),
        ...(rateN !== Number(charge.unitPrice) ? { unitPrice: rateN } : {}),
        ...(gstN !== Number(charge.gstRatePct) ? { gstRatePct: gstN } : {}),
      });
      onSaved(
        [
          repriced && `"${charge.description}" is now ${qtyN} × ₹${money(rateN)} = ₹${money(now)}`,
          dateMoved && `dated ${chargeDateLabel(parsed!.toISOString())}`,
        ].filter(Boolean).join(", ") +
          (repriced && discharged ? ". The discharge bill has been re-issued to match." : "."),
      );
    } catch (e) {
      // The 403 from a switched-off desk and the IRN / cancelled-bill
      // refusals arrive here already worded for the reader, as does "this
      // patient was admitted on…". Do not replace them with something generic.
      setError(e instanceof ApiClientError ? e.message : "Could not save the correction.");
    } finally { setBusy(false); }
  }

  const fld = "w-full rounded-lg border border-[var(--p-border)] bg-white px-3 py-2 text-sm text-[var(--p-ink)] outline-none";
  const label = "mb-1.5 block text-[10.5px] font-semibold uppercase tracking-wide text-[var(--p-muted)]";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="surface w-full max-w-lg bg-white">
        <div className="flex items-center justify-between border-b border-[var(--p-border)] px-6 py-4">
          <div>
            <h3 className="text-[14px] font-semibold text-[var(--p-ink)]">Correct this line</h3>
            <p className="mt-0.5 text-[11.5px] text-[var(--p-muted)]">
              What it cost, and when it was actually given.
            </p>
          </div>
          <button onClick={onClose} className="text-[var(--p-muted)] hover:text-[var(--p-ink)]">✕</button>
        </div>

        {error && (
          <div className="border-b border-[var(--p-border)] bg-[var(--p-rose-soft)] px-6 py-3 text-[12.5px] text-[var(--p-rose)]">
            {error}
          </div>
        )}

        {/* ── THE BILL IS ALREADY ISSUED ──
            Only for the money. A date is not on that document, so re-dating a
            line on a discharged stay changes nothing the family is holding. */}
        {discharged && (
          <div className="border-b border-[var(--p-border)] bg-[var(--p-amber-soft)] px-6 py-3 text-[12px] leading-relaxed text-[#8a6414]">
            <strong>This stay is discharged and its bill is issued.</strong> Changing the qty, rate or GST
            re-issues that invoice on the new figures, keeping its receipt number; if the new total is less
            than the money recorded as collected, the recorded payment is lowered to the new total.
            Changing only the date re-issues nothing.
          </div>
        )}

        <div className="p-6">
          {/* THE LINE ITSELF, so nobody corrects the row above the one they meant. */}
          <div className="rounded-lg border border-[var(--p-border)] bg-[var(--p-bg)] px-4 py-3">
            <div className="text-[13px] font-medium text-[var(--p-ink)]">{charge.description}</div>
            <div className="mt-0.5 text-[12px] text-[var(--p-muted)]">
              Now {charge.qty} × ₹{money(Number(charge.unitPrice))} = <span className="font-mono">₹{money(was)}</span>
              {" · "}{chargeDateLabel(charge.createdAt)}
            </div>
          </div>

          {/* ── THE MONEY ── */}
          <div className="mt-5 grid gap-4 sm:grid-cols-3">
            <div>
              <label className={label}>Qty</label>
              <input className={fld} value={qty} inputMode="numeric"
                onFocus={(e) => (e.currentTarget.style.borderColor = ring)}
                onBlur={(e) => (e.currentTarget.style.borderColor = "")}
                onChange={(e) => setQty(e.target.value.replace(/\D/g, ""))} />
            </div>
            <div>
              <label className={label}>Rate (₹)</label>
              <input className={fld} value={rate} inputMode="decimal"
                onFocus={(e) => (e.currentTarget.style.borderColor = ring)}
                onBlur={(e) => (e.currentTarget.style.borderColor = "")}
                onChange={(e) => setRate(e.target.value.replace(/[^\d.]/g, ""))} />
            </div>
            <div>
              <label className={label}>GST %</label>
              <input className={fld} value={gst} inputMode="decimal"
                onFocus={(e) => (e.currentTarget.style.borderColor = ring)}
                onBlur={(e) => (e.currentTarget.style.borderColor = "")}
                onChange={(e) => setGst(e.target.value.replace(/[^\d.]/g, ""))} />
            </div>
          </div>
          <p className="mt-2 text-[11.5px] leading-relaxed text-[var(--p-muted)]">
            Repricing keeps the line and its history - who raised it and when - which deleting and adding
            it back does not. Most hospital services are GST-exempt; leave it 0 unless your CA says
            otherwise.
          </p>

          {/* ── THE DATE ── */}
          <div className="mt-5 border-t border-[var(--p-border)] pt-5">
            <label className={label}>Date &amp; time given</label>
            <input type="datetime-local" className={fld} value={date}
              min={toLocalInput(new Date(admittedAt))}
              max={toLocalInput(dischargedAt ? new Date(dischargedAt) : new Date())}
              onFocus={(e) => (e.currentTarget.style.borderColor = ring)}
              onBlur={(e) => (e.currentTarget.style.borderColor = "")}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void save(); } }}
              onChange={(e) => setDate(e.target.value)} />
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-[var(--p-muted)]">
              Must fall inside the stay - not before the admission, not after the discharge, never in the
              future. The tab is ordered by this, so the line moves to where it belongs.
            </p>
          </div>

          {/* ── WHAT IT COMES TO ── */}
          <div className="mt-6 rounded-lg border border-[var(--p-border)] bg-[var(--p-bg)] px-4 py-3">
            {!moneyValid ? (
              <p className="text-[12.5px] text-[var(--p-rose)]">
                {qtyN < 1
                  ? "A line has to be for at least one of something."
                  : qtyN > 999
                    ? "That quantity is too large - 999 is the most a single line can carry."
                    : rateBlank
                      ? "Type a rate. To take the charge off the tab, use Remove - not a blank box."
                      : "GST has to be between 0 and 28%."}
              </p>
            ) : dateMoved && !dateValid ? (
              <p className="text-[12.5px] text-[var(--p-rose)]">That is not a real date and time.</p>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-[13px] font-semibold text-[var(--p-ink)]">This line</span>
                  <span className="font-mono text-[15px] font-bold text-[var(--p-ink)]">₹{money(now)}</span>
                </div>
                {Math.abs(delta) >= 0.01 && (
                  <p className={`mt-1.5 text-[12px] font-semibold ${delta > 0 ? "text-[#8a6414]" : "text-[var(--p-teal-deep)]"}`}>
                    {delta > 0 ? "↑" : "↓"} ₹{money(Math.abs(delta))} on what this line bills today.
                    {" "}
                    <span className="font-normal text-[var(--p-muted)]">Was ₹{money(was)}.</span>
                  </p>
                )}
                {gstN > 0 && (
                  <p className="mt-1 text-[11.5px] text-[var(--p-muted)]">
                    Plus {gstN}% GST, added per line on the bill itself.
                  </p>
                )}
              </>
            )}
          </div>
          <p className="mt-3 text-[11.5px] leading-relaxed text-[var(--p-muted)]">
            Whatever you change is kept on the stay&apos;s record - the old figures and the new ones,
            against your name.
          </p>
        </div>

        <div className="flex flex-wrap justify-end gap-3 border-t border-[var(--p-border)] p-5">
          <button onClick={onClose}
            className="rounded-lg border border-[var(--p-border)] px-4 py-2.5 text-sm font-medium text-[var(--p-text)] hover:border-[var(--p-muted)]">
            Cancel
          </button>
          <button onClick={save} disabled={busy || !changed || !moneyValid || (dateMoved && !dateValid)}
            style={{ background: ring }}
            className="inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40">
            {busy
              ? <><Spinner /> Saving…</>
              : <><Icon name="check" size={14} /> {discharged && repriced ? "Save & re-issue the bill" : "Save the correction"}</>}
          </button>
        </div>
      </div>
    </div>
  );
}

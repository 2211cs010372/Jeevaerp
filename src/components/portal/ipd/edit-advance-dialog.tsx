"use client";

import { useState } from "react";
import { Icon } from "@/components/portal/ui/icons";
import { Spinner } from "@/components/portal/ui/form-atoms";
import { api, ApiClientError } from "@/lib/api-client";

/**
 * CORRECTING A DEPOSIT SLIP - the one money document the desk could not fix.
 *
 * An advance receipt is a bill as far as the family is concerned: the same
 * letterhead, the same counter, real cash handed over, a numbered slip in a ward
 * bag. Every other such document has an edit path - the bill dialog, the running
 * tab's line correction, the stay correction - and this one had none, so a
 * ₹20,000 deposit keyed in as ₹2,000, or taken on Saturday and entered on
 * Monday, stayed wrong on the paper the family is holding (owner, 2 Oct 2026).
 *
 * THE DATE MOVES THE MONEY, and the dialog says so rather than burying it. A
 * deposit has ONE date - `createdAt` - and the slip, the stay sheet, the IP
 * bill's Payment Details and the day close all read it. Re-date a deposit and a
 * closed day's cash total changes with it. That is the owner's rule and the
 * opposite of what a silent "printed date only" column would do, which is to
 * hand the desk a slip and a day close that disagree.
 *
 * THE AMOUNT ON A DISCHARGED STAY REACHES THE ISSUED BILL. The deposit is
 * already a payment on that invoice, so a corrected figure is re-applied to it -
 * capped at what the bill has room for, with anything over left refundable. The
 * banner names that before Save is pressed.
 *
 * WHAT IT DOES NOT DO: decide whether this desk may edit money documents. That
 * is HospitalConfig.billEditingEnabled, checked inside updateAdvance - the same
 * line CorrectChargeDialog and the bill dialog draw, for the same reason.
 */

const pad = (n: number) => String(n).padStart(2, "0");

/** A Date as `<input type="datetime-local">` wants it: local wall clock. */
function toLocalInput(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** dd-mm-yyyy, h:mm AM/PM - how the slip itself prints the instant. */
function dateLabel(iso: string): string {
  const x = new Date(iso);
  if (Number.isNaN(x.getTime())) return "-";
  const h = x.getHours();
  return `${pad(x.getDate())}-${pad(x.getMonth() + 1)}-${x.getFullYear()}, ${h % 12 === 0 ? 12 : h % 12}:${pad(x.getMinutes())} ${h >= 12 ? "PM" : "AM"}`;
}

const money = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (s: string) => Number(s) || 0;

const MODES = ["CASH", "UPI", "CARD", "NETBANKING", "OTHER"] as const;
const MODE_LABEL: Record<string, string> = {
  CASH: "Cash", UPI: "UPI", CARD: "Card", NETBANKING: "Net banking", OTHER: "Other",
};

export interface EditableAdvance {
  id: string;
  receiptNo: string | null;
  amount: string;
  mode: string;
  reference: string | null;
  /** ISO instant - AdmissionAdvance.createdAt, as the stay sheet returns it. */
  takenAt: string;
}

export function EditAdvanceDialog({
  advance,
  admittedAt,
  dischargedAt,
  discharged,
  accent = "teal",
  onClose,
  onSaved,
}: {
  advance: EditableAdvance;
  admittedAt: string;
  /** Null while the patient is still in a bed - then the ceiling is now. */
  dischargedAt: string | null;
  /** The stay is closed, so its bill exists and this deposit is sitting on it. */
  discharged: boolean;
  accent?: "teal" | "blue";
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  // ── THE MINUTE TRAP ── `datetime-local` has no seconds, so a deposit taken at
  // 15:42:37 seeds the box as 15:42. A box still equal to what it was seeded
  // with means the date was NOT edited and is not sent - otherwise opening the
  // dialog to fix a typo would quietly move the money thirty-seven seconds and
  // write an audit entry saying somebody re-dated the slip.
  const seededDate = toLocalInput(new Date(advance.takenAt));
  const [date, setDate] = useState(seededDate);
  const [amount, setAmount] = useState(String(Number(advance.amount)));
  const [mode, setMode] = useState(advance.mode);
  const [reference, setReference] = useState(advance.reference ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ring = accent === "blue" ? "var(--p-blue)" : "var(--p-teal)";

  const parsed = date ? new Date(date) : null;
  const dateValid = !!parsed && !Number.isNaN(parsed.getTime());
  const dateMoved = !!date && date !== seededDate;

  const was = Number(advance.amount);
  // An EMPTY box is not ₹0. A deposit of nothing is not a correction - the slip
  // would then acknowledge money the family did in fact hand over.
  const blank = amount.trim() === "";
  const amountN = num(amount);
  const amountValid = !blank && amountN > 0;
  const delta = amountN - was;

  const changed =
    dateMoved
    || (amountValid && Math.abs(delta) >= 0.01)
    || mode !== advance.mode
    || reference.trim() !== (advance.reference ?? "").trim();

  const canSave = changed && amountValid && (!dateMoved || dateValid) && !busy;

  async function save() {
    if (!canSave) return;
    setBusy(true); setError(null);
    try {
      await api.patch(`/ipd/advances/${advance.id}`, {
        amount: amountN,
        mode,
        // Empty CLEARS the reference - a UPI ref typed onto a cash deposit has
        // to be removable, and `undefined` would leave it in place.
        reference: reference.trim() || null,
        ...(dateMoved ? { takenAt: parsed!.toISOString() } : {}),
      });
      onSaved(
        [
          `${advance.receiptNo ?? "The deposit"} is now ₹${money(amountN)} ${MODE_LABEL[mode] ?? mode}`,
          dateMoved && `dated ${dateLabel(parsed!.toISOString())}`,
        ].filter(Boolean).join(", ")
          + (discharged && Math.abs(delta) >= 0.01
            ? ". The discharge bill has been re-adjusted against it."
            : "."),
      );
    } catch (e) {
      // The 403 from a switched-off desk and "this patient was admitted on…"
      // both arrive here already worded for the reader.
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
            <h3 className="text-[14px] font-semibold text-[var(--p-ink)]">
              Correct {advance.receiptNo ?? "this deposit"}
            </h3>
            <p className="mt-0.5 text-[11.5px] text-[var(--p-muted)]">
              The receipt number stays the same — this corrects the slip, it does not reissue it.
            </p>
          </div>
          <button onClick={onClose} className="text-[var(--p-muted)] hover:text-[var(--p-ink)]">✕</button>
        </div>

        {error && (
          <div className="border-b border-[var(--p-border)] bg-[var(--p-rose-soft)] px-6 py-3 text-[12.5px] text-[var(--p-rose)]">
            {error}
          </div>
        )}

        {/* ── THE BILL IS ALREADY ISSUED ── only the amount reaches it. */}
        {discharged && (
          <div className="border-b border-[var(--p-border)] bg-[var(--p-amber-soft)] px-6 py-3 text-[12px] leading-relaxed text-[#8a6414]">
            <strong>This stay is discharged and its bill is issued.</strong> This deposit is already
            adjusted against that bill, so a corrected amount is re-applied to it — as much as the bill
            has room for, with anything over left as refundable. Lowering the deposit brings the balance
            on that bill back.
          </div>
        )}

        <div className="p-6">
          {/* THE SLIP ITSELF, so nobody corrects the deposit below the one they meant. */}
          <div className="rounded-lg border border-[var(--p-border)] bg-[var(--p-bg)] px-4 py-3">
            <div className="text-[13px] font-medium text-[var(--p-ink)]">
              <span className="font-mono">{advance.receiptNo ?? "Not numbered"}</span>
              {" · "}₹{money(was)} {MODE_LABEL[advance.mode] ?? advance.mode}
            </div>
            <div className="mt-0.5 text-[12px] text-[var(--p-muted)]">
              Taken {dateLabel(advance.takenAt)}
              {advance.reference ? ` · ${advance.reference}` : ""}
            </div>
          </div>

          {/* ── THE MONEY AND HOW IT CAME IN ── */}
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <div>
              <label className={label}>Amount (₹)</label>
              <input className={fld} value={amount} inputMode="decimal"
                onFocus={(e) => (e.currentTarget.style.borderColor = ring)}
                onBlur={(e) => (e.currentTarget.style.borderColor = "")}
                onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} />
            </div>
            <div>
              <label className={label}>Mode</label>
              <select className={fld} value={mode} onChange={(e) => setMode(e.target.value)}
                onFocus={(e) => (e.currentTarget.style.borderColor = ring)}
                onBlur={(e) => (e.currentTarget.style.borderColor = "")}>
                {MODES.map((m) => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}
              </select>
            </div>
          </div>

          <div className="mt-4">
            <label className={label}>Reference <span className="font-normal normal-case tracking-normal">(UPI txn id, card auth — optional)</span></label>
            <input className={fld} value={reference} maxLength={80}
              onFocus={(e) => (e.currentTarget.style.borderColor = ring)}
              onBlur={(e) => (e.currentTarget.style.borderColor = "")}
              onChange={(e) => setReference(e.target.value)} />
          </div>

          {/* ── THE DATE ── */}
          <div className="mt-5 border-t border-[var(--p-border)] pt-5">
            <label className={label}>Date &amp; time taken</label>
            <input type="datetime-local" className={fld} value={date}
              min={toLocalInput(new Date(admittedAt))}
              max={toLocalInput(dischargedAt ? new Date(dischargedAt) : new Date())}
              onFocus={(e) => (e.currentTarget.style.borderColor = ring)}
              onBlur={(e) => (e.currentTarget.style.borderColor = "")}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void save(); } }}
              onChange={(e) => setDate(e.target.value)} />
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-[var(--p-muted)]">
              Must fall inside the stay — not before the admission, not after the discharge, never in the
              future. <strong>This date is the deposit&apos;s only date</strong>: the slip, the stay bill and
              that day&apos;s cash total all read it, so moving it moves the money into the day you pick.
            </p>
          </div>

          {/* ── WHAT IT COMES TO ── */}
          <div className="mt-6 rounded-lg border border-[var(--p-border)] bg-[var(--p-bg)] px-4 py-3">
            {!amountValid ? (
              <p className="text-[12.5px] text-[var(--p-rose)]">
                {blank
                  ? "Type the amount the family actually handed over."
                  : "A deposit has to be more than ₹0."}
              </p>
            ) : dateMoved && !dateValid ? (
              <p className="text-[12.5px] text-[var(--p-rose)]">That is not a real date and time.</p>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-[13px] font-semibold text-[var(--p-ink)]">This deposit</span>
                  <span className="font-mono text-[15px] font-bold text-[var(--p-ink)]">₹{money(amountN)}</span>
                </div>
                {Math.abs(delta) >= 0.01 && (
                  <p className={`mt-1.5 text-[12px] font-semibold ${delta > 0 ? "text-[var(--p-teal-deep)]" : "text-[#8a6414]"}`}>
                    {delta > 0 ? "↑" : "↓"} ₹{money(Math.abs(delta))} on what the slip says today.
                    {" "}
                    <span className="font-normal text-[var(--p-muted)]">Was ₹{money(was)}.</span>
                  </p>
                )}
                {dateMoved && dateValid && (
                  <p className="mt-1 text-[11.5px] text-[var(--p-muted)]">
                    Will count in {dateLabel(parsed!.toISOString()).split(",")[0]}&apos;s collection, not{" "}
                    {dateLabel(advance.takenAt).split(",")[0]}&apos;s.
                  </p>
                )}
              </>
            )}
          </div>
          <p className="mt-3 text-[11.5px] leading-relaxed text-[var(--p-muted)]">
            The old figures and the new ones are both kept on the stay&apos;s record, against your name.
            Reprint the slip afterwards — the family is holding the old one.
          </p>
        </div>

        <div className="flex flex-wrap justify-end gap-3 border-t border-[var(--p-border)] p-5">
          <button onClick={onClose}
            className="rounded-lg border border-[var(--p-border)] px-4 py-2.5 text-sm font-medium text-[var(--p-text)] hover:border-[var(--p-muted)]">
            Cancel
          </button>
          <button onClick={save} disabled={!canSave} style={{ background: ring }}
            className="inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40">
            {busy ? <><Spinner /> Saving…</> : <><Icon name="check" size={14} /> Save the correction</>}
          </button>
        </div>
      </div>
    </div>
  );
}

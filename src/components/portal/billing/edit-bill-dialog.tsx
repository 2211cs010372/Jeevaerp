"use client";

import { useEffect, useMemo, useState } from "react";
import { PrimaryButton } from "@/components/portal/ui/primitives";
import { Icon } from "@/components/portal/ui/icons";
import { Spinner } from "@/components/portal/ui/form-atoms";
import { DiscountInput } from "@/components/portal/ui/bill-fields";
import { api, ApiClientError } from "@/lib/api-client";
import { localDateISO } from "@/lib/date";
// Pure arithmetic - no database, no clock, no network (see the header of that
// file). Imported so this dialog predicts the total using the SAME function the
// server stores it with, rather than an approximation of it.
import { computeInvoiceTotals, billTrimsPaymentOnShortfall } from "@/server/billing/calc";

/**
 * EDITING A BILL, IN ONE PLACE.
 *
 * Reception, the pharmacy, the lab counter, the insurance room and admin all
 * correct bills, and all five want the same dialog: fix the date, swap the
 * lines, fix an amount, adjust the discount, keep the receipt number. Written
 * five times it would drift five ways - and the way it drifts is that one copy
 * forgets a rule the others enforce, on a document the tax authority reads.
 *
 * PAID BILLS COME THROUGH HERE TOO. That used to be impossible and the server
 * refused it outright; it now allows it, subject to one rule this dialog exists
 * to make visible: a bill may not be corrected BELOW the money already
 * collected against it. The banner names the figure before anything is typed and
 * Save goes dead if the lines fall under it, because finding that out from a red
 * box after pressing Save - on a bill whose receipt the patient is holding - is
 * the wrong moment to learn it.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO:
 *
 *   It does not decide whether the desk is allowed to be here. The Edit button
 *   is drawn by the caller from `useBillEditing()`, and the real permission is
 *   HospitalConfig.billEditingEnabled, checked server-side inside updateInvoice.
 *   A dialog that hid itself would be a permission made of CSS.
 *
 *   It does not enforce the money rules either - it only shows them early. The
 *   floor, the IRN and the cancelled-bill refusal all hold in updateInvoice, and
 *   their messages are surfaced here verbatim.
 */

export interface EditableInvoice {
  id: string;
  receiptNo: string;
  status: string;
  /** LAB / PHARMACY / IPD / … - with `admissionId`, decides whether a line can
   *  be removed below what was collected. See `trimsOnShortfall`. */
  source: string;
  /** The stay this bill is on, or null. A LAB/PHARMACY bill on a stay is a
   *  running-tab line the desk may correct past the collected floor. */
  admissionId: string | null;
  /** When the row was written. Never edited - it is what the day close counts. */
  createdAt: string;
  /** The corrected date this bill prints, when a desk has set one. */
  billDate: string | null;
  items: {
    description: string; qty: number; unitPrice: string; amount: string;
    gstRatePct: string; hsnSac: string | null;
  }[];
  discountAmount: string;
  totalAmount: string;
  amountPaid: string;
}

function formatDateTimeForInput(iso: string | null | undefined): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return "";
  }
}

function formatDateTimeAmPm(iso: string | null | undefined): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleString("en-US", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return "";
  }
}

export function EditBillDialog({
  invoiceId,
  accent = "teal",
  onClose,
  onSaved,
}: {
  invoiceId: string;
  accent?: "teal" | "blue";
  onClose: () => void;
  onSaved: () => void;
}) {
  const [inv, setInv] = useState<EditableInvoice | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The printed date and time as YYYY-MM-DDTHH:mm. Seeded from the bill once it arrives. */
  const [date, setDate] = useState("");

  useEffect(() => {
    let live = true;
    api.get<{ invoice: EditableInvoice }>(`/billing/invoice/${invoiceId}`)
      .then((r) => {
        if (!live) return;
        setInv(r.invoice);
        setDate(formatDateTimeForInput(r.invoice.billDate ?? r.invoice.createdAt));
      })
      .catch((e) => { if (live) setError(e instanceof ApiClientError ? e.message : "Couldn't open the bill."); });
    return () => { live = false; };
  }, [invoiceId]);

  /** The real date/time this bill was raised - what the box goes back to on Reset. */
  const realDate = inv ? formatDateTimeForInput(inv.createdAt) : "";
  const dateMoved = !!inv && date !== realDate;
  const future = date ? new Date(date).getTime() > Date.now() + 24 * 60 * 60 * 1000 : false;

  // ── WHAT HAS ALREADY BEEN COLLECTED ──
  //
  // A paid bill IS editable, so the number that used to be irrelevant here is
  // now the most important one on the screen: the total may not be corrected
  // below it. Shown, and checked live against the running subtotal, so the desk
  // finds out while typing rather than from a red box after pressing Save.
  const collected = inv ? Number(inv.amountPaid) || 0 : 0;
  /** Lines before discount and before GST - what the discount box works against. */
  const subtotal = inv ? inv.items.reduce((s, i) => s + Number(i.unitPrice || 0) * (i.qty || 1), 0) : 0;

  /**
   * A LAB OR PHARMACY BILL ON A STAY TRIMS INSTEAD OF REFUSING.
   *
   * On a running tab the desk takes a wrong test off the way it takes any other
   * line off, collected or not - the server lowers the recorded payment to the
   * new total rather than blocking the edit (see updateInvoice). An OP or
   * walk-in bill is unchanged: there the collected figure is a hard floor and
   * the refund flow is the way under it. The server decides this from the bill
   * itself; this flag only keeps the dialog's warning and its Save button honest
   * about which bill is in front of the desk.
   */
  const trimsOnShortfall = !!inv && billTrimsPaymentOnShortfall({ source: inv.source, admissionId: inv.admissionId });

  /**
   * WHAT THE SERVER WILL ACTUALLY STORE - GST included.
   *
   * This used to be a pre-GST subtotal compared against a GST-inclusive figure,
   * described as warning "a little early". It did not warn early; it warned
   * ALWAYS. Money collected on a bill includes its tax, the lines summed here do
   * not, so `subtotal < collected` held on every settled bill that carried any
   * GST - which is all 275 of the pharmacy's. Both Save buttons are disabled on
   * this flag, so a collected bill could not be corrected at all: not its lines,
   * not its amount, and not its date, which is what the counter kept hitting.
   *
   * Computed by the same pure function `updateInvoice` uses, so what this screen
   * predicts and what the server stores cannot drift apart.
   */
  const newTotal = useMemo(() => {
    if (!inv?.items.length) return 0;
    try {
      return computeInvoiceTotals(
        inv.items.map((i) => ({
          description: i.description,
          qty: i.qty,
          unitPrice: Number(i.unitPrice) || 0,
          gstRatePct: Number(i.gstRatePct) || 0,
        })),
        Number(inv.discountAmount) || 0,
      ).total;
    } catch {
      // A discount above the subtotal throws here and is caught by its own field.
      // Not a reason to seize the Save button - the server states the refusal.
      return 0;
    }
  }, [inv]);

  // The same paise tolerance assertTotalCoversCollected applies, so a bill
  // settled to the exact rupee is not refused on a rounding crumb.
  const below = collected > 0 && newTotal < collected - 0.01;
  // On a stay's lab/pharmacy bill, below-collected is not a wall - it trims the
  // payment. So it blocks Save only where the server would actually refuse it.
  const belowCollected = below && !trimsOnShortfall;
  /** Below collected, but on a bill where that lowers the payment rather than
   *  refusing - a warning to show, not a reason to seize Save. */
  const willTrim = below && trimsOnShortfall;

  async function save(): Promise<boolean> {
    if (!inv) return false;
    setBusy(true); setError(null);
    try {
      await api.patch(`/billing/invoice/${inv.id}`, {
        lines: inv.items.map((i) => ({
          description: i.description,
          qty: i.qty,
          unitPrice: Number(i.unitPrice),
          gstRatePct: Number(i.gstRatePct),
          hsnSac: i.hsnSac ?? undefined,
        })),
        discountAmount: Number(inv.discountAmount) || undefined,
        // Back on the real date means there is no correction to keep, so the
        // override is CLEARED rather than stored as a value equal to createdAt.
        // A bill carrying a redundant billDate would read, in the audit log and
        // to the next person, as one somebody deliberately re-dated.
        billDate: dateMoved ? (date ? new Date(date).toISOString() : null) : null,
      });
      onSaved();
      return true;
    } catch (e) {
      // The 403 from a switched-off desk arrives here, and its wording tells the
      // user exactly who can turn it on. Do not replace it with a generic line.
      setError(e instanceof ApiClientError ? e.message : "Could not save the bill.");
      return false;
    } finally { setBusy(false); }
  }

  /**
   * Save, then open the sheet - the whole point of correcting a bill is usually
   * to hand a right one over. Printing only happens if the save actually landed:
   * a 403 from a switched-off desk that still produced a printout would put the
   * uncorrected bill in the patient's hand while the screen showed the error.
   */
  async function saveAndPrint() {
    if (!inv) return;
    if (await save()) window.open(`/print/invoice/${inv.id}`, "_blank", "noopener,noreferrer");
  }

  const fld = "w-full rounded-lg border border-[var(--p-border)] bg-white px-3 py-2 text-sm text-[var(--p-ink)] outline-none focus:border-[var(--p-teal)]";
  const patch = (idx: number, next: Partial<EditableInvoice["items"][number]>) =>
    setInv((p) => (p ? { ...p, items: p.items.map((x, i) => (i === idx ? { ...x, ...next } : x)) } : p));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="surface w-full max-w-2xl bg-white">
        <div className="flex items-center justify-between border-b border-[var(--p-border)] px-6 py-4">
          <div>
            <h3 className="text-[14px] font-semibold text-[var(--p-ink)]">
              Edit {inv?.receiptNo ?? "bill"}
            </h3>
            <p className="mt-0.5 text-[11.5px] text-[var(--p-muted)]">
              The receipt number stays the same — this corrects the bill, it does not reissue it.
            </p>
          </div>
          <button onClick={onClose} className="text-[var(--p-muted)] hover:text-[var(--p-ink)]">✕</button>
        </div>

        {error && (
          <div className="border-b border-[var(--p-border)] bg-[var(--p-rose-soft)] px-6 py-3 text-[12.5px] text-[var(--p-rose)]">
            {error}
          </div>
        )}

        {!inv ? (
          <div className="flex items-center justify-center gap-2 py-16 text-[13px] text-[var(--p-muted)]">
            <Spinner /> Opening the bill…
          </div>
        ) : (
          <>
            <div className="max-h-[60vh] overflow-y-auto overscroll-contain p-6">
              {/* ── MONEY IS ALREADY AGAINST THIS BILL ──
                  Said once, at the top, before anything is typed. The patient is
                  holding a receipt for this figure, and the correction has to
                  live above it. */}
              {collected > 0 && (
                <div className={`mb-5 border-l-2 px-4 py-3 text-[12px] leading-relaxed ${
                  belowCollected
                    ? "border-[var(--p-rose)] bg-[var(--p-rose-soft)] text-[var(--p-rose)]"
                    : "border-[#d8b878] bg-[var(--p-amber-soft)] text-[#8a6414]"}`}>
                  {belowCollected ? (
                    <>
                      <strong>₹{collected.toFixed(2)} has already been collected on this bill.</strong>{" "}
                      The lines now come to ₹{newTotal.toFixed(2)} including GST, which is less than that — the
                      server will refuse this. Refund the difference first, then correct the bill.
                    </>
                  ) : willTrim ? (
                    // A test taken off a stay's lab/pharmacy bill: the removal
                    // saves and the recorded payment drops to match.
                    <>
                      <strong>₹{collected.toFixed(2)} was collected; the lines now come to ₹{newTotal.toFixed(2)}.</strong>{" "}
                      This bill is on the stay&apos;s running tab, so the test comes off and the recorded
                      payment is lowered to ₹{newTotal.toFixed(2)} to match. The ₹{(collected - newTotal).toFixed(2)}
                      {" "}difference is cash already in the drawer — hand it back at the counter; no refund is
                      recorded here, and that day&apos;s collection shows the lower figure.
                    </>
                  ) : (
                    <>
                      <strong>₹{collected.toFixed(2)} has already been collected on this bill</strong>{" "}
                      and the patient has a receipt for it.{" "}
                      {trimsOnShortfall
                        ? "This bill is on the stay's running tab, so you can take a test off it even below that figure — the recorded payment drops to match."
                        : "You can correct this bill, but not to a total below that figure."}{" "}
                      If the total goes up, the difference reappears as a balance to collect.
                    </>
                  )}
                </div>
              )}

              {/* ── THE PRINTED DATE & TIME ──
                  Above the lines because it is the field people come here for
                  after the fact: the amounts were right, the day/time was not. */}
              <div className="mb-5 border-b border-[var(--p-border)] pb-5">
                <label className="mb-1.5 block text-[10.5px] font-semibold uppercase tracking-wide text-[var(--p-muted)]">
                  Bill date &amp; time
                </label>
                <div className="flex flex-wrap items-center gap-3">
                  <input
                    type="datetime-local"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className={`${fld} !w-auto`}
                  />
                  {dateMoved && (
                    <button
                      onClick={() => setDate(realDate)}
                      className="rounded-lg border border-[var(--p-border)] px-3 py-1.5 text-[12px] font-medium text-[var(--p-text)] hover:border-[var(--p-teal)]"
                    >
                      Back to {formatDateTimeAmPm(realDate)}
                    </button>
                  )}
                </div>
                {date && formatDateTimeAmPm(date) && (
                  <p className="mt-1.5 text-[11.5px] font-medium text-[var(--p-teal-deep)]">
                    Prints as: <span className="font-semibold">{formatDateTimeAmPm(date)}</span>
                  </p>
                )}
                {future ? (
                  <p className="mt-2 text-[11.5px] text-[var(--p-rose)]">
                    A bill can&apos;t be dated in the future.
                  </p>
                ) : dateMoved ? (
                  <p className="mt-2 text-[11.5px] leading-relaxed text-[var(--p-muted)]">
                    The bill will show this date and time everywhere — its own copy, the stay bill it is
                    folded into, and the day&apos;s collection.{" "}
                    <strong>The money moves with it:</strong> what was collected on this bill counts in
                    the new day&apos;s total instead of {formatDateTimeAmPm(inv.createdAt)}&apos;s, when it was
                    keyed in. A day close printed before this edit will no longer match.
                  </p>
                ) : (
                  <p className="mt-2 text-[11.5px] leading-relaxed text-[var(--p-muted)]">
                    The day &amp; time this bill was raised. Change it if the treatment was given on a different day or time.
                  </p>
                )}
              </div>

              <div className="mb-2 grid grid-cols-[1fr_70px_90px_80px] gap-2 text-[10.5px] font-semibold uppercase tracking-wide text-[var(--p-muted)]">
                <span>Description</span><span>Qty</span><span>Rate</span><span />
              </div>
              <div className="space-y-3">
                {inv.items.map((it, idx) => (
                  <div key={idx} className="grid grid-cols-[1fr_70px_90px_80px] items-center gap-2">
                    <input className={fld} value={it.description}
                      onChange={(e) => patch(idx, { description: e.target.value })} />
                    <input className={fld} value={it.qty} inputMode="numeric"
                      onChange={(e) => patch(idx, { qty: Number(e.target.value.replace(/\D/g, "")) || 1 })} />
                    <input className={fld} value={it.unitPrice} inputMode="decimal"
                      onChange={(e) => patch(idx, { unitPrice: e.target.value.replace(/[^\d.]/g, "") })} />
                    <button
                      onClick={() => setInv({ ...inv, items: inv.items.filter((_, i) => i !== idx) })}
                      disabled={inv.items.length === 1}
                      className="rounded-lg border border-[var(--p-rose)]/30 py-2 text-[12px] text-[var(--p-rose)] hover:bg-[var(--p-rose-soft)] disabled:opacity-40">
                      Remove
                    </button>
                  </div>
                ))}
              </div>
              <button
                onClick={() => setInv({ ...inv, items: [...inv.items, { description: "", qty: 1, unitPrice: "0", amount: "0", gstRatePct: "0", hsnSac: null }] })}
                className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-[var(--p-border)] px-3 py-2 text-[12px] font-medium text-[var(--p-teal)] hover:border-[var(--p-teal)]">
                <Icon name="plus" size={13} /> Add line
              </button>

              <div className="mt-5 max-w-[220px]">
                <DiscountInput
                  subtotal={subtotal}
                  accent={accent}
                  initialAmount={Number(inv.discountAmount) || 0}
                  onChange={(d) => setInv((p) => (p ? { ...p, discountAmount: String(d.amount) } : p))}
                />
              </div>

              {/* GST is recomputed server-side from each line's own rate - shown
                  here so nobody is surprised that the saved total is not the
                  subtotal they were just looking at. */}
              <p className="mt-4 text-[11.5px] leading-relaxed text-[var(--p-muted)]">
                Subtotal ₹{subtotal.toFixed(2)} before discount. GST is recalculated from each
                line&apos;s own rate when you save, and the edit is recorded with your name.
              </p>
            </div>

            <div className="flex flex-wrap justify-end gap-3 border-t border-[var(--p-border)] p-5">
              <button onClick={onClose} className="rounded-lg border border-[var(--p-border)] px-4 py-2 text-sm text-[var(--p-text)]">
                Discard
              </button>
              <button
                onClick={saveAndPrint}
                disabled={busy || future || belowCollected || inv.items.length === 0}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--p-border)] px-4 py-2 text-sm font-medium text-[var(--p-text)] hover:border-[var(--p-teal)] hover:text-[var(--p-teal)] disabled:opacity-40"
              >
                <Icon name="printer" size={15} /> Save &amp; print
              </button>
              <PrimaryButton onClick={save} disabled={busy || future || belowCollected || inv.items.length === 0}>
                {busy ? <><Spinner /> Saving…</> : <><Icon name="check" size={15} /> Save changes</>}
              </PrimaryButton>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * "May this desk edit bills?" - asked once per screen.
 *
 * Reads the operational settings endpoint, which every staff role can see. The
 * answer only decides whether a button is DRAWN; the server decides whether the
 * write lands. Defaults to false while loading and on any error, so a desk never
 * flashes a control it turns out not to have.
 */
export function useBillEditing(): { canEdit: boolean; checking: boolean } {
  const [canEdit, setCanEdit] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let live = true;
    api.get<{ settings: { billEditingEnabled: boolean } }>("/settings")
      .then((r) => { if (live) setCanEdit(!!r.settings.billEditingEnabled); })
      .catch(() => { if (live) setCanEdit(false); })
      .finally(() => { if (live) setChecking(false); });
    return () => { live = false; };
  }, []);

  return { canEdit, checking };
}

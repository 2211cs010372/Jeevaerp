"use client";

/**
 * THE TWO THINGS THAT GET FILLED IN WRONG AT A BUSY WINDOW - fixed after the
 * fact, from the queue, without re-ordering anything.
 *
 *  * NO DOCTOR. The chit is in the patient's hand, the desk is three deep, and
 *    the order goes in as a walk-in. The report then reads "Ref. Doctor: Self /
 *    walk-in" and goes back to a doctor who is not named on it.
 *  * THE WRONG DAY. A sample taken on Saturday evening is typed in on Monday,
 *    and "Registered On" prints Monday - which the patient can read, on a sheet
 *    they carry to another hospital.
 *
 * Both belong to the whole ORDER, never to one test inside it: the tests came
 * off one tube on one day against one chit, and a sheet that disagreed with its
 * siblings about either would be the harder mistake to spot.
 *
 * The date is a DAY, because that is what a counter can fill in without
 * fumbling - the server keeps the time of day it is replacing, so a corrected
 * sheet doesn't claim every back-dated sample arrived at midnight.
 */

import { useState } from "react";
import { Icon } from "@/components/portal/ui/icons";
import { Spinner } from "@/components/portal/ui/form-atoms";
import { ReferrerSelect, type RosterDoctor } from "@/components/portal/labs/referrer-select";
import { IN_HOUSE_REFERRER } from "@/lib/labs/referrer";
import { api, ApiClientError } from "@/lib/api-client";

/** What the panel needs off a queue row - a subset of LabOrderDTO. */
export interface EditableOrder {
  id: string;
  createdAt: string;
  orderedAt: string | null;
  appointment: { opNumber: string; doctorName: string; visitDate: string } | null;
  referringDoctor: { id: string; name: string } | null;
  /** Set when the referrer is not a doctor - the hospital itself, most often.
   *  Without it an in-house order re-opened here read as "Self / walk-in" and
   *  a save would have quietly thrown the referrer away. */
  referringName?: string | null;
}

/** "2026-08-04" in the browser's own calendar - what a date field wants. */
const formatDateTimeForInput = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const formatDateTimeAmPm = (val: string) => {
  if (!val) return "";
  const d = new Date(val);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString("en-US", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
};

export function OrderEditPanel({ order, doctors, onSaved, onClose }: {
  order: EditableOrder;
  doctors: RosterDoctor[];
  /** Fired after the server confirms - the caller reloads its list. */
  onSaved: () => void;
  onClose: () => void;
}) {
  const enteredInput = formatDateTimeForInput(order.createdAt);
  const initialInput = formatDateTimeForInput(order.orderedAt ?? order.createdAt);
  const [date, setDate] = useState(initialInput);
  // The select's value is a doctor id, "" for self-referral, or the in-house
  // sentinel. An order carrying a referringName is one the hospital referred.
  const initialReferrer =
    order.referringDoctor?.id ?? (order.referringName ? IN_HOUSE_REFERRER : "");
  const [doctorId, setDoctorId] = useState(initialReferrer);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A test raised off a consultation already has a referring doctor: the one
  // who saw the patient. The field is shown but locked, so the answer to "why
  // can't I set this?" is on screen rather than in a rejected save.
  const fromVisit = !!order.appointment;
  const dirty = date !== initialInput
    || (!fromVisit && doctorId !== initialReferrer);

  async function save() {
    setBusy(true); setError(null);
    try {
      await api.patch(`/labs/orders/${order.id}`, {
        // Sent only when it changed, and `null` clears rather than omits - an
        // absent key means "leave it alone" all the way to the column.
        ...(fromVisit ? {} : { referringDoctorId: doctorId || null }),
        orderedAt: date === enteredInput ? null : (date ? new Date(date).toISOString() : null),
      });
      onSaved();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not save that.");
    } finally { setBusy(false); }
  }

  return (
    <div className="border-t border-dashed border-[var(--p-border)] bg-[var(--p-bg)] px-6 py-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-[12px] font-semibold text-[var(--p-ink)]">
            Registered on <span className="font-normal text-[var(--p-muted)]">(date &amp; time the sample came in)</span>
          </label>
          <input
            type="datetime-local" value={date} max={formatDateTimeForInput(new Date().toISOString())}
            onChange={(e) => setDate(e.target.value)}
            className="w-full rounded-lg border border-[var(--p-border)] bg-white px-3 py-2 text-sm text-[var(--p-ink)] outline-none transition-colors focus:border-[var(--p-teal)]"
          />
          {date && formatDateTimeAmPm(date) && (
            <p className="mt-1 text-[11px] font-medium text-[var(--p-teal-deep)]">
              Prints as: {formatDateTimeAmPm(date)}
            </p>
          )}
          <p className="mt-1 text-[12px] leading-snug text-[var(--p-muted)]">
            Prints on the report as Registered On.
            {date !== enteredInput ? (
              <>
                {" "}Typed in on <span className="tabular">{formatDateTimeAmPm(order.createdAt)}</span> -{" "}
                <button onClick={() => setDate(enteredInput)} className="underline underline-offset-2 hover:text-[var(--p-ink)]">
                  use that instead
                </button>.
              </>
            ) : " Same time it was typed in."}
          </p>
        </div>

        <div>
          <ReferrerSelect
            compact
            label="Referring doctor"
            doctors={doctors}
            value={fromVisit ? "" : doctorId}
            onChange={setDoctorId}
            disabled={fromVisit}
            hint={fromVisit
              ? `Taken from the consultation - ${order.appointment?.doctorName} (${order.appointment?.opNumber}).`
              : "Who wrote the chit. Blank prints as self / walk-in."}
          />
        </div>
      </div>

      {error && (
        <p className="mt-3 flex items-center gap-1.5 text-[12px] text-[var(--p-rose)]">
          <Icon name="alert" size={13} /> {error}
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          onClick={save} disabled={busy || !dirty}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--p-teal)] px-3.5 py-1.5 text-[12px] font-semibold text-white transition-colors hover:bg-[var(--p-teal-deep)] disabled:opacity-40">
          {busy ? <Spinner size={12} /> : <Icon name="check" size={13} />} Save
        </button>
        <button
          onClick={onClose} disabled={busy}
          className="rounded-lg border border-[var(--p-border)] px-3.5 py-1.5 text-[12px] font-medium text-[var(--p-text)] transition-colors hover:border-[var(--p-teal)] hover:text-[var(--p-teal)]">
          Cancel
        </button>
        <span className="text-[12px] text-[var(--p-muted)]">
          Applies to every test on this order.
        </span>
      </div>
    </div>
  );
}

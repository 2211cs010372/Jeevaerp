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
import { api, ApiClientError } from "@/lib/api-client";

/** What the panel needs off a queue row - a subset of LabOrderDTO. */
export interface EditableOrder {
  id: string;
  createdAt: string;
  orderedAt: string | null;
  appointment: { opNumber: string; doctorName: string; visitDate: string } | null;
  referringDoctor: { id: string; name: string } | null;
}

/** "2026-08-04" in the browser's own calendar - what a date field wants. */
const dateValue = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export function OrderEditPanel({ order, doctors, onSaved, onClose }: {
  order: EditableOrder;
  doctors: RosterDoctor[];
  /** Fired after the server confirms - the caller reloads its list. */
  onSaved: () => void;
  onClose: () => void;
}) {
  const entered = dateValue(order.createdAt);
  const [date, setDate] = useState(dateValue(order.orderedAt ?? order.createdAt));
  const [doctorId, setDoctorId] = useState(order.referringDoctor?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A test raised off a consultation already has a referring doctor: the one
  // who saw the patient. The field is shown but locked, so the answer to "why
  // can't I set this?" is on screen rather than in a rejected save.
  const fromVisit = !!order.appointment;
  const dirty = date !== dateValue(order.orderedAt ?? order.createdAt)
    || (!fromVisit && doctorId !== (order.referringDoctor?.id ?? ""));

  async function save() {
    setBusy(true); setError(null);
    try {
      await api.patch(`/labs/orders/${order.id}`, {
        // Sent only when it changed, and `null` clears rather than omits - an
        // absent key means "leave it alone" all the way to the column.
        ...(fromVisit ? {} : { referringDoctorId: doctorId || null }),
        orderedAt: date === entered ? null : date,
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
            Registered on <span className="font-normal text-[var(--p-muted)]">(the day the sample came in)</span>
          </label>
          <input
            type="date" value={date} max={dateValue(new Date().toISOString())}
            onChange={(e) => setDate(e.target.value)}
            className="w-full rounded-lg border border-[var(--p-border)] bg-white px-3 py-2 text-sm text-[var(--p-ink)] outline-none transition-colors focus:border-[var(--p-teal)]"
          />
          <p className="mt-1 text-[12px] leading-snug text-[var(--p-muted)]">
            Prints on the report as Registered On.
            {date !== entered ? (
              <>
                {" "}Typed in on <span className="tabular">{entered}</span> -{" "}
                <button onClick={() => setDate(entered)} className="underline underline-offset-2 hover:text-[var(--p-ink)]">
                  use that instead
                </button>.
              </>
            ) : " Same day it was typed in."}
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

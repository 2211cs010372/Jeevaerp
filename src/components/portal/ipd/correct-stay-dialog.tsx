"use client";

import { useMemo, useState } from "react";
import { Icon } from "@/components/portal/ui/icons";
import { Req, Spinner } from "@/components/portal/ui/form-atoms";
import { api, ApiClientError } from "@/lib/api-client";
import { bedLabel } from "@/lib/beds";

/**
 * Standard hospital wards with current official tariffs.
 * Transcribed from Jeeva Multispeciality Hospital official rate boards.
 */
export const STANDARD_WARDS = [
  { name: "ICU", rate: 6000, label: "ICU (₹6,000/day)" },
  { name: "Deluxe Room", rate: 5500, label: "Deluxe Room (₹5,500/day)" },
  { name: "Special Room", rate: 5000, label: "Special Room / Private (₹5,000/day)" },
  { name: "Sharing Room", rate: 4000, label: "Sharing Room / Semi-Private (₹4,000/day)" },
  { name: "General Ward", rate: 2500, label: "General Ward (₹2,500/day)" },
] as const;

export interface StayLeg {
  id: string; wardName: string; bedNo: string; dailyCharge: string;
  from: string; to: string | null; days: number; total: string; current: boolean;
  billedDays: number | null;
}

export interface StayBillingSnapshot {
  admittedAt: string;
  dischargedAt: string | null;
  status: string;
  dailyCharge: string;
  nursePerDay: string;
  nursingApplies: boolean;
  legs: StayLeg[];
}

export interface EditableLeg {
  id: string;
  wardName: string;
  dailyCharge: string;
  days: string;
  isNew?: boolean;
}

const DAY_MS = 86_400_000;
const stayDays = (from: Date, until: Date) =>
  Math.max(1, Math.ceil((until.getTime() - from.getTime()) / DAY_MS));

const pad = (n: number) => String(n).padStart(2, "0");
function toLocalInput(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
const money = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (s: string) => Number(s) || 0;

export function CorrectStayDialog({
  admissionId,
  stay,
  accent = "teal",
  onClose,
  onSaved,
}: {
  admissionId: string;
  stay: StayBillingSnapshot;
  accent?: "teal" | "blue";
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const closed = stay.status !== "ADMITTED";

  const seededAdmitted = toLocalInput(new Date(stay.admittedAt));
  const seededDischarged = stay.dischargedAt ? toLocalInput(new Date(stay.dischargedAt)) : "";

  const [admitted, setAdmitted] = useState(seededAdmitted);
  const [discharged, setDischarged] = useState(seededDischarged);

  const admittedAt = admitted === seededAdmitted ? stay.admittedAt : admitted;
  const dischargedAt = discharged === seededDischarged ? stay.dischargedAt : discharged;
  const [nurse, setNurse] = useState(() => String(Number(stay.nursePerDay)));

  // Editable list of ward legs
  const [legs, setLegs] = useState<EditableLeg[]>(() => {
    if (stay.legs.length > 0) {
      return stay.legs.map((l) => ({
        id: l.id,
        wardName: l.wardName || "General Ward",
        dailyCharge: String(Number(l.dailyCharge)),
        days: String(l.billedDays ?? l.days),
        isNew: false,
      }));
    }
    const derivedDays = stayDays(
      new Date(stay.admittedAt),
      stay.dischargedAt ? new Date(stay.dischargedAt) : new Date()
    );
    return [
      {
        id: "leg-init-1",
        wardName: "General Ward",
        dailyCharge: String(Number(stay.dailyCharge || 2500)),
        days: String(derivedDays),
        isNew: false,
      },
    ];
  });

  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ring = accent === "blue" ? "var(--p-blue)" : "var(--p-teal)";

  // Derived stay dates duration
  const stayDateDays = useMemo(() => {
    const from = new Date(admittedAt);
    const to = dischargedAt ? new Date(dischargedAt) : new Date();
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) return 1;
    return stayDays(from, to);
  }, [admittedAt, dischargedAt]);

  // Preview computations
  const preview = useMemo(() => {
    const from = new Date(admittedAt);
    const to = dischargedAt ? new Date(dischargedAt) : null;
    if (Number.isNaN(from.getTime()) || (to && Number.isNaN(to.getTime()))) return null;

    const until = to ?? new Date();
    if (until <= from) return null;

    const durationDays = stayDays(from, until);
    const legCalculations = legs.map((l) => {
      const d = Math.max(1, Math.floor(num(l.days)));
      const rate = num(l.dailyCharge);
      return {
        ...l,
        days: d,
        rate,
        total: d * rate,
      };
    });

    const bedTotal = legCalculations.reduce((s, l) => s + l.total, 0);
    const totalLegDays = legCalculations.reduce((s, l) => s + l.days, 0);
    const nurseTotal = totalLegDays * num(nurse);

    return {
      days: durationDays,
      totalLegDays,
      legs: legCalculations,
      bedTotal,
      nurseTotal,
      total: bedTotal + nurseTotal,
    };
  }, [admittedAt, dischargedAt, legs, nurse]);

  const wasBed = stay.legs.length
    ? stay.legs.reduce((s, l) => s + num(l.total), 0)
    : stayDays(new Date(stay.admittedAt), stay.dischargedAt ? new Date(stay.dischargedAt) : new Date()) * num(stay.dailyCharge);
  const wasDays = stayDays(
    new Date(stay.admittedAt),
    stay.dischargedAt ? new Date(stay.dischargedAt) : new Date()
  );
  const wasNurse = wasDays * num(stay.nursePerDay);
  const wasTotal = wasBed + wasNurse;
  const delta = preview ? preview.total - wasTotal : 0;

  const future =
    new Date(admittedAt) > new Date() || (!!dischargedAt && new Date(dischargedAt) > new Date());

  // Function to add another ward leg (e.g. transfer to ICU / Deluxe room)
  function handleAddLeg() {
    setLegs((prev) => [
      ...prev,
      {
        id: `new-${Date.now()}`,
        wardName: "ICU",
        dailyCharge: "6000",
        days: "1",
        isNew: true,
      },
    ]);
  }

  // Function to remove a leg (if more than 1)
  function handleRemoveLeg(index: number) {
    if (legs.length <= 1) return;
    setLegs((prev) => prev.filter((_, i) => i !== index));
  }

  // When ward is selected in dropdown
  function handleWardChange(index: number, selectedWardName: string) {
    const matched = STANDARD_WARDS.find((w) => w.name === selectedWardName);
    setLegs((prev) => {
      const next = [...prev];
      next[index] = {
        ...next[index],
        wardName: selectedWardName,
        dailyCharge: matched ? String(matched.rate) : next[index].dailyCharge,
      };
      return next;
    });
  }

  // Function to auto-sync discharge date to match total bed days
  function handleSyncDatesToBedDays() {
    if (!preview || preview.totalLegDays <= 0) return;
    const from = new Date(admittedAt);
    const newUntil = new Date(from.getTime() + preview.totalLegDays * DAY_MS);
    if (closed) {
      setDischarged(toLocalInput(newUntil));
    }
  }

  // Function to distribute stay duration into legs
  function handleDistributeDays() {
    if (legs.length === 0) return;
    const total = stayDateDays;
    const share = Math.max(1, Math.floor(total / legs.length));
    const rem = total - share * legs.length;
    setLegs((prev) =>
      prev.map((l, i) => ({
        ...l,
        days: String(share + (i === prev.length - 1 ? rem : 0)),
      }))
    );
  }

  async function save() {
    if (!preview || future) return;
    setBusy(true); setError(null);
    try {
      await api.patch(`/ipd/admissions/${admissionId}/billing`, {
        admittedAt: new Date(admittedAt).toISOString(),
        ...(closed && dischargedAt ? { dischargedAt: new Date(dischargedAt).toISOString() } : {}),
        ...(stay.nursingApplies ? { nursePerDay: num(nurse) } : {}),
        legs: legs.map((l) => ({
          ...(l.isNew ? {} : { id: l.id }),
          wardName: l.wardName.trim(),
          dailyCharge: num(l.dailyCharge),
          billedDays: Math.max(1, Math.floor(num(l.days))),
        })),
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      });
      onSaved(
        closed
          ? "Stay charges corrected. The discharge bill & IPD invoice have been re-issued to match."
          : "Stay charges corrected. The running tab has been updated to the new figures."
      );
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not save the correction.");
    } finally {
      setBusy(false);
    }
  }

  const fld = "w-full rounded-xl border border-[#e5e5e5] bg-white px-3 py-2 text-[13px] text-[#111111] placeholder:text-[#a3a3a3] outline-none transition-all focus:border-[#111111] focus:ring-1 focus:ring-[#111111]";
  const label = "mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-[#737373]";
  const maxNow = toLocalInput(new Date());

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-[2px] p-4 sm:p-6">
      <div className="surface w-full max-w-2xl bg-white rounded-2xl shadow-2xl overflow-hidden border border-[#e5e5e5] animate-in fade-in zoom-in-95 duration-150 flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#e5e5e5] px-6 py-4 bg-white shrink-0">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-[#f5f5f4] text-[#111111] border border-[#e5e5e5]">
                <Icon name="bed" size={13} />
              </span>
              <h3 className="text-[15px] font-semibold text-[#111111]">Edit Bed Charges &amp; Wards</h3>
            </div>
            <p className="mt-1 text-[12px] text-[#737373]">
              Update room types (ICU, Deluxe, Special, Sharing, General), daily rates, days billed, or split stay across wards.
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-7 w-7 items-center justify-center rounded-lg text-[#737373] hover:bg-[#f5f5f4] hover:text-[#111111] transition-colors border border-transparent hover:border-[#e5e5e5]"
          >
            <Icon name="x" size={14} />
          </button>
        </div>

        {error && (
          <div className="border-b border-[#e5e5e5] bg-rose-50 px-6 py-3 text-[12.5px] font-medium text-rose-700">
            {error}
          </div>
        )}

        {/* Post-Discharge Alert */}
        {closed && (
          <div className="border-b border-[#e5e5e5] bg-[#f5f5f4] px-6 py-3 text-[12px] leading-relaxed text-[#404040] flex items-center gap-2.5">
            <span className="shrink-0 rounded-full bg-[#111111] px-2 py-0.5 text-[10px] font-bold text-white uppercase tracking-wider">
              Discharged Stay
            </span>
            <span>
              This stay is closed and bills are settled. Updating here automatically recalculates the bed charges and re-issues the discharge bill &amp; IPD invoice cleanly without error states.
            </span>
          </div>
        )}

        <div className="flex-1 overflow-y-auto overscroll-contain p-6 space-y-6">
          {/* 1. Dates Section */}
          <div className="rounded-xl border border-[#e5e5e5] bg-[#fafafa] p-4">
            <div className="flex items-center justify-between mb-3">
              <label className={label}>Stay Period</label>
              <span className="rounded-full border border-[#e5e5e5] bg-white px-2.5 py-0.5 text-[11px] font-semibold text-[#111111]">
                Duration: {stayDateDays} day{stayDateDays === 1 ? "" : "s"}
              </span>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <span className="block text-[11px] font-medium text-[#737373] mb-1.5">
                  Admitted Date &amp; Time<Req />
                </span>
                <input
                  type="datetime-local"
                  className={fld}
                  value={admitted}
                  max={maxNow}
                  onChange={(e) => setAdmitted(e.target.value)}
                />
              </div>
              <div>
                <span className="block text-[11px] font-medium text-[#737373] mb-1.5">
                  Discharged Date &amp; Time{closed && <Req />}
                </span>
                <input
                  type="datetime-local"
                  className={`${fld} disabled:bg-[#f5f5f4] disabled:text-[#8e8e8e] disabled:cursor-not-allowed`}
                  value={discharged}
                  max={maxNow}
                  disabled={!closed}
                  onChange={(e) => setDischarged(e.target.value)}
                />
                {!closed && (
                  <p className="mt-1 text-[11px] text-[#737373]">
                    Currently admitted. Bed charges calculate up to today.
                  </p>
                )}
              </div>
            </div>

            {closed && preview && preview.totalLegDays !== stayDateDays && (
              <div className="mt-3 flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-1.5 text-[11.5px] text-amber-900">
                <span>Discharge date ({stayDateDays}d) differs from bed days billed ({preview.totalLegDays}d)</span>
                <button
                  type="button"
                  onClick={handleSyncDatesToBedDays}
                  className="font-semibold text-[#111111] underline hover:no-underline"
                >
                  Sync discharge date to {preview.totalLegDays} bed days
                </button>
              </div>
            )}
          </div>

          {/* 2. Ward & Bed Charges Allocation */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <div>
                <label className={label}>Ward / Room Allocations</label>
                <p className="text-[12px] text-[#737373]">
                  Select the room type (ICU, Deluxe, Special, Sharing, General). Rates auto-populate to hospital tariffs.
                </p>
              </div>
              <button
                type="button"
                onClick={handleAddLeg}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#e5e5e5] bg-white px-3 py-1.5 text-[12px] font-semibold text-[#111111] hover:border-[#111111] hover:bg-[#fafafa] transition-colors shadow-2xs"
              >
                <Icon name="plus" size={13} /> Add Ward / Split Stay
              </button>
            </div>

            <div className="space-y-3">
              {legs.map((leg, idx) => {
                const subtotal = num(leg.dailyCharge) * Math.max(1, Math.floor(num(leg.days)));
                const isMatchedStandard = STANDARD_WARDS.some((w) => w.name === leg.wardName);

                return (
                  <div
                    key={leg.id || idx}
                    className="rounded-xl border border-[#e5e5e5] bg-white p-3.5 transition-all hover:border-[#d4d4d4] shadow-2xs"
                  >
                    <div className="flex items-center justify-between pb-2 mb-2 border-b border-[#f0f0f0]">
                      <div className="flex items-center gap-2">
                        <span className="rounded-full bg-[#f5f5f4] border border-[#e5e5e5] px-2 py-0.5 text-[10.5px] font-bold text-[#404040]">
                          Leg #{idx + 1}
                        </span>
                        <span className="text-[12.5px] font-semibold text-[#111111]">
                          {leg.wardName}
                        </span>
                      </div>

                      <div className="flex items-center gap-3">
                        <div className="text-right">
                          <span className="text-[11px] text-[#737373] mr-1">Subtotal:</span>
                          <span className="font-mono text-[13.5px] font-bold text-[#111111]">
                            ₹{money(subtotal)}
                          </span>
                        </div>
                        {legs.length > 1 && (
                          <button
                            type="button"
                            onClick={() => handleRemoveLeg(idx)}
                            title="Remove this ward line"
                            className="flex h-6 w-6 items-center justify-center rounded-md border border-[#e5e5e5] bg-white text-[#737373] hover:border-rose-300 hover:bg-rose-50 hover:text-rose-600 transition-colors"
                          >
                            <Icon name="x" size={12} />
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
                      {/* Ward Selector */}
                      <div className="sm:col-span-6">
                        <span className="block text-[11px] font-medium text-[#737373] mb-1">
                          Room / Ward Type
                        </span>
                        <select
                          className={fld}
                          value={isMatchedStandard ? leg.wardName : "CUSTOM"}
                          onChange={(e) => {
                            if (e.target.value !== "CUSTOM") {
                              handleWardChange(idx, e.target.value);
                            }
                          }}
                        >
                          {STANDARD_WARDS.map((w) => (
                            <option key={w.name} value={w.name}>
                              {w.label}
                            </option>
                          ))}
                          {!isMatchedStandard && (
                            <option value="CUSTOM">Custom ({leg.wardName})</option>
                          )}
                        </select>
                      </div>

                      {/* Rate Input */}
                      <div className="sm:col-span-3">
                        <span className="block text-[11px] font-medium text-[#737373] mb-1">
                          Rate (₹/day)
                        </span>
                        <input
                          className={fld}
                          inputMode="decimal"
                          value={leg.dailyCharge}
                          placeholder="2500"
                          onChange={(e) => {
                            const val = e.target.value.replace(/[^\d.]/g, "");
                            setLegs((prev) => {
                              const next = [...prev];
                              next[idx] = { ...next[idx], dailyCharge: val };
                              return next;
                            });
                          }}
                        />
                      </div>

                      {/* Days Input */}
                      <div className="sm:col-span-3">
                        <span className="block text-[11px] font-medium text-[#737373] mb-1">
                          Billed Days
                        </span>
                        <input
                          className={fld}
                          inputMode="numeric"
                          value={leg.days}
                          placeholder="1"
                          onChange={(e) => {
                            const val = e.target.value.replace(/\D/g, "");
                            setLegs((prev) => {
                              const next = [...prev];
                              next[idx] = { ...next[idx], days: val };
                              return next;
                            });
                          }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Allocation Days Summary & Helpers */}
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#e5e5e5] bg-[#fafafa] p-3 text-[12px]">
              <div>
                <span className="text-[#737373]">Total Bed Days: </span>
                <span className="font-semibold text-[#111111]">{preview?.totalLegDays ?? 0} days</span>
                {preview && preview.totalLegDays === stayDateDays ? (
                  <span className="ml-2 font-medium text-emerald-600">✓ In sync with stay period</span>
                ) : (
                  <span className="ml-2 font-medium text-amber-700">
                    (Stay duration: {stayDateDays} days)
                  </span>
                )}
              </div>
              {legs.length > 1 && preview && preview.totalLegDays !== stayDateDays && (
                <button
                  type="button"
                  onClick={handleDistributeDays}
                  className="font-medium text-[#111111] underline hover:no-underline"
                >
                  Distribute {stayDateDays} days across wards
                </button>
              )}
            </div>
          </div>

          {/* 3. Nursing (where applicable) */}
          {stay.nursingApplies && (
            <div className="border-t border-[#e5e5e5] pt-4">
              <label className={label}>Nursing care — per day</label>
              <div className="flex flex-wrap items-center gap-3">
                <input
                  className={`${fld} !w-[130px]`}
                  value={nurse}
                  inputMode="decimal"
                  onChange={(e) => setNurse(e.target.value.replace(/[^\d.]/g, ""))}
                />
                <span className="font-mono text-[12.5px] text-[#737373]">
                  × {preview?.totalLegDays ?? wasDays}d = ₹{money(preview?.nurseTotal ?? wasNurse)}
                </span>
              </div>
            </div>
          )}

          {/* 4. Reason for Edit */}
          <div className="border-t border-[#e5e5e5] pt-4">
            <label className={label}>Reason for update (Optional)</label>
            <input
              className={fld}
              value={reason}
              maxLength={200}
              placeholder="e.g. Admitted in ICU directly; patient upgraded to Deluxe; corrected 2d General + 3d ICU"
              onChange={(e) => setReason(e.target.value)}
            />
            <p className="mt-1 text-[11px] text-[#737373]">
              Recorded in the hospital audit trail alongside the stay record.
            </p>
          </div>

          {/* 5. Live Summary Preview */}
          <div className="rounded-xl border border-[#e5e5e5] bg-[#f5f5f4] p-4 space-y-2.5">
            <h4 className="text-[11px] font-bold uppercase tracking-wider text-[#737373]">
              Summary &amp; Billing Preview
            </h4>

            {future || !preview ? (
              <p className="text-[12.5px] text-rose-600 font-medium">
                {future
                  ? "Dates cannot be in the future."
                  : "Invalid dates. Discharge date must be after admission date."}
              </p>
            ) : (
              <>
                <div className="space-y-1.5 text-[12.5px]">
                  {preview.legs.map((l, i) => (
                    <div key={i} className="flex items-center justify-between">
                      <span className="text-[#525252]">
                        {l.wardName} · {l.days} day{l.days === 1 ? "" : "s"} × ₹{money(l.rate)}
                      </span>
                      <span className="font-mono font-medium text-[#111111]">₹{money(l.total)}</span>
                    </div>
                  ))}
                  {stay.nursingApplies && (
                    <div className="flex items-center justify-between pt-1 border-t border-[#e5e5e5]">
                      <span className="text-[#525252]">Nursing care</span>
                      <span className="font-mono font-medium text-[#111111]">₹{money(preview.nurseTotal)}</span>
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between border-t border-[#e5e5e5] pt-2.5">
                  <span className="text-[13.5px] font-bold text-[#111111]">Total Bed &amp; Stay Charges</span>
                  <span className="font-mono text-[16px] font-bold text-[#111111]">₹{money(preview.total)}</span>
                </div>

                {Math.abs(delta) >= 0.01 && (
                  <p className={`text-[12px] font-medium ${delta > 0 ? "text-amber-800" : "text-emerald-700"}`}>
                    {delta > 0 ? "↑ Increases" : "↓ Decreases"} by ₹{money(Math.abs(delta))} compared to previous bill total.
                  </p>
                )}
              </>
            )}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[#e5e5e5] bg-[#fafafa] px-6 py-4 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-[#e5e5e5] bg-white px-4 py-2 text-[13px] font-medium text-[#404040] hover:border-[#111111] hover:text-[#111111] transition-colors shadow-2xs"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={busy || !preview || future}
            className="inline-flex items-center gap-2 rounded-xl bg-[#111111] px-5 py-2 text-[13px] font-semibold text-white hover:bg-black disabled:opacity-40 transition-colors shadow-xs"
          >
            {busy ? (
              <><Spinner /> Updating &amp; Re-issuing…</>
            ) : (
              <><Icon name="check" size={14} /> {closed ? "Save & Re-issue Bill" : "Save Bed Charges"}</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

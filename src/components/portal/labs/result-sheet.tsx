"use client";

/**
 * ENTERING RESULTS FOR ONE ORDER.
 *
 * A patient who gives one tube for a CBC, an LFT and a thyroid panel is three
 * tests but one job at the bench. The sheet therefore opens on the ORDER: every
 * test picked in that submit is a tab across the top, values are held per tab,
 * and each is saved as it is finished. `Save & next` walks the order without
 * ever going back to the queue.
 *
 * The tabs are the ORDER's tests and nothing else. They were briefly everything
 * the patient had on file, which sounded helpful and wasn't: a regular's sheet
 * opened with a wall of tabs from visits months apart, and the one job in front
 * of the technician was somewhere among them. What isn't on this order isn't
 * this order's work - it has its own row in the queue.
 *
 * Each tab is loaded on first sight, not up front - a ten-test order would
 * otherwise pay for ten sheets to look at one.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { PrimaryButton } from "@/components/portal/ui/primitives";
import { Icon } from "@/components/portal/ui/icons";
import { Spinner } from "@/components/portal/ui/form-atoms";
import { api, ApiClientError } from "@/lib/api-client";
import { analyteDescription } from "@/lib/lab-reference";

export type Flag = "NORMAL" | "HIGH" | "LOW" | "ABNORMAL";

export interface ResultRow {
  name: string; unit: string | null; value: string;
  refLow: string | null; refHigh: string | null; refText: string | null;
  flag: Flag; sortOrder: number;
}

export interface Sheet {
  test: {
    id: string; testName: string; status: string; completedAt: string | null;
    impression: string | null; technicianName: string | null;
    patient: { displayId: string; fullName: string; age: number | null; gender: string | null } | null;
  };
  results: ResultRow[];
  fromTemplate: boolean;
}

/** A test on the order - all the sheet needs to label a tab before it is loaded. */
export interface SheetTest {
  id: string; testName: string; status: string;
  patient: { id: string; displayId: string; fullName: string } | null;
}

interface TabState {
  sheet: Sheet | null;
  rows: ResultRow[];
  impression: string;
  completedAt: string;
  loading: boolean;
  error: string | null;
  /** Edited since it was loaded or last saved - what a close would throw away. */
  dirty: boolean;
  /** Saved during THIS sitting, as opposed to completed at some point in the past. */
  savedNow: boolean;
}

const BLANK: TabState = { sheet: null, rows: [], impression: "", completedAt: "", loading: true, error: null, dirty: false, savedNow: false };

function formatDateForInput(iso: string | null | undefined): string {
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

/**
 * A range bound the sheet can actually grade against.
 *
 * The bounds are typed by hand now, so "1.2", "" and "1..2" all reach this. A
 * half-typed or mistyped bound is NOT a bound: graded against it every value
 * would come back NORMAL, which is the one wrong answer this screen must never
 * give. Unparseable reads as no bound at all, and the line falls through to the
 * abnormal checkbox where a person decides.
 */
function bound(v: string | null): number | null {
  if (v == null || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Mirrors flagFor() on the server so the bench sees H/L as it types. */
function liveFlag(value: string, refLow: string | null, refHigh: string | null): Flag | "" {
  const t = value.trim();
  if (!t) return "";
  const n = Number(t);
  if (!Number.isFinite(n)) return "";
  const lo = bound(refLow);
  const hi = bound(refHigh);
  if (lo == null && hi == null) return "";
  if (hi != null && n > hi) return "HIGH";
  if (lo != null && n < lo) return "LOW";
  return "NORMAL";
}

const FLAG_STYLE: Record<Flag, string> = {
  NORMAL: "bg-[var(--p-teal-soft)] text-[var(--p-teal-deep)]",
  HIGH: "bg-[var(--p-rose-soft)] text-[var(--p-rose)]",
  LOW: "bg-[var(--p-amber-soft)] text-[#8a6414]",
  ABNORMAL: "bg-[var(--p-rose-soft)] text-[var(--p-rose)]",
};

export interface SavedTest { id: string; testName: string }

export function ResultSheet({
  orderId,
  tests,
  openAt,
  onClose,
  onSaved,
}: {
  /** The order these tests belong to - what "print them all" prints. */
  orderId: string;
  /** Every test on the order - one tab each, in the sequence it was ordered. */
  tests: SheetTest[];
  /** Which of them the technician clicked. The rest are one click away. */
  openAt: string;
  onClose: () => void;
  /** Fired after every successful save, so the queue behind can refresh. */
  onSaved: (saved: SavedTest, patientName: string) => void;
}) {
  const [tabs, setTabs] = useState<SheetTest[]>(tests);
  const [activeId, setActiveId] = useState(openAt);
  const [state, setState] = useState<Record<string, TabState>>({});
  const [saving, setSaving] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);

  const opened = useMemo(() => tabs.find((t) => t.id === openAt) ?? tabs[0], [tabs, openAt]);
  const patientName = opened?.patient?.fullName ?? "-";

  const patch = useCallback((id: string, p: Partial<TabState>) => {
    setState((s) => ({ ...s, [id]: { ...(s[id] ?? BLANK), ...p } }));
  }, []);

  const loadSheet = useCallback(async (id: string) => {
    patch(id, { ...BLANK, loading: true });
    try {
      const sh = await api.get<Sheet>(`/labs/tests/${id}/results`);
      patch(id, {
        sheet: sh, rows: sh.results, impression: sh.test.impression ?? "",
        completedAt: formatDateForInput(sh.test.completedAt),
        loading: false, error: null, dirty: false,
      });
    } catch (e) {
      patch(id, { loading: false, error: e instanceof ApiClientError ? e.message : "Couldn't open the result sheet." });
    }
  }, [patch]);

  // Only the clicked tab is fetched. The others are already labelled from the
  // queue row, and load when they are actually opened.
  useEffect(() => { loadSheet(openAt); }, [openAt, loadSheet]);

  const active = state[activeId];
  const activeTab = tabs.find((t) => t.id === activeId) ?? opened;
  const dirtyCount = useMemo(() => Object.values(state).filter((s) => s.dirty).length, [state]);

  /** The next tab still waiting for results - what `Save & next` moves to. */
  const nextPending = useMemo(() => {
    const i = tabs.findIndex((t) => t.id === activeId);
    const rest = [...tabs.slice(i + 1), ...tabs.slice(0, Math.max(0, i))];
    return rest.find((t) => !state[t.id]?.savedNow && t.status === "PENDING") ?? null;
  }, [tabs, activeId, state]);

  function select(id: string) {
    setActiveId(id);
    setConfirmClose(false);
    if (!state[id]) loadSheet(id);
  }

  function setRow(i: number, p: Partial<ResultRow>) {
    if (!active) return;
    patch(activeId, { rows: active.rows.map((r, j) => (j === i ? { ...r, ...p } : r)), dirty: true });
  }

  /** An analyte the catalogue's template doesn't list - or a whole free-form test. */
  function addRow() {
    if (!active) return;
    patch(activeId, {
      rows: [...active.rows, {
        name: "", unit: null, value: "", refLow: null, refHigh: null, refText: null,
        flag: "NORMAL", sortOrder: active.rows.length,
      }],
      dirty: true,
    });
  }

  function removeRow(i: number) {
    if (!active) return;
    patch(activeId, { rows: active.rows.filter((_, j) => j !== i), dirty: true });
  }

  async function save(advance: boolean) {
    if (!active) return;
    const items = active.rows
      .filter((r) => r.name.trim() && r.value.trim())
      .map((r) => ({
        name: r.name.trim(), unit: r.unit?.trim() || null, value: r.value.trim(),
        // A bound that doesn't parse is stored as no bound - see bound() above.
        // Sending NaN would reach the server as null anyway; doing it here means
        // the flag on screen and the flag on the report agree about why.
        refLow: bound(r.refLow),
        refHigh: bound(r.refHigh),
        refText: r.refText?.trim() || null,
        // Only the lab can say whether "Positive" or "Growth seen" is abnormal -
        // no range can. Sent for every line; the server ignores it on a value
        // it can grade against a range itself.
        abnormal: r.flag === "ABNORMAL",
      }));
    if (items.length === 0) { patch(activeId, { error: "Enter a value for at least one analyte." }); return; }

    setSaving(true);
    patch(activeId, { error: null });
    const id = activeId;
    try {
      // Impression is always sent, even empty: on this screen a cleared box means
      // the technician deleted what they had written, not "leave it as it was".
      await api.put(`/labs/tests/${id}/results`, {
        items,
        impression: active.impression.trim(),
        completedAt: active.completedAt ? new Date(active.completedAt).toISOString() : null,
      });
      patch(id, { dirty: false, savedNow: true });
      setTabs((ts) => ts.map((t) => (t.id === id ? { ...t, status: "COMPLETED" } : t)));
      onSaved({ id, testName: activeTab.testName }, patientName);
      // The sheet STAYS OPEN. Closing it on save dropped the technician back on
      // a list they then had to search to print the report they were seconds
      // away from. The values remain on screen and editable if a digit was
      // mistyped - and with a panel open, the next test is one click away.
      if (advance && nextPending) select(nextPending.id);
    } catch (e) {
      patch(id, { error: e instanceof ApiClientError ? e.message : "Could not save the results." });
    } finally { setSaving(false); }
  }

  function requestClose() {
    if (dirtyCount > 0) { setConfirmClose(true); return; }
    onClose();
  }

  const savedCount = Object.values(state).filter((s) => s.savedNow).length;
  /** Tests on this order that have a report to print - saved now or long since. */
  const doneCount = tabs.filter((t) => state[t.id]?.savedNow || t.status === "COMPLETED").length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={requestClose}>
      <div onClick={(e) => e.stopPropagation()} className="surface flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden bg-white">
        {/* ── who, and which of their tests ── */}
        <div className="flex items-start justify-between gap-4 border-b border-[var(--p-border)] px-6 py-4">
          <div>
            <h3 className="text-[15px] font-semibold text-[var(--p-ink)]">{activeTab.testName}</h3>
            <p className="text-[13px] text-[var(--p-muted)]">
              {patientName} · <span className="tabular">{opened?.patient?.displayId ?? "-"}</span>
              {active?.sheet?.fromTemplate && (
                <span className="ml-2 rounded bg-[var(--p-teal-soft)] px-1.5 py-0.5 text-[10px] font-bold uppercase text-[var(--p-teal-deep)]">from template</span>
              )}
            </p>
          </div>
          <button onClick={requestClose} className="text-[var(--p-muted)] hover:text-[var(--p-ink)]" aria-label="Close">✕</button>
        </div>

        {tabs.length > 1 && (
          <div className="flex items-center gap-1.5 overflow-x-auto border-b border-[var(--p-border)] bg-[var(--p-bg)] px-4 py-2.5">
            {tabs.map((t) => {
              const st = state[t.id];
              const on = t.id === activeId;
              const done = st?.savedNow || t.status === "COMPLETED";
              return (
                <button
                  key={t.id} onClick={() => select(t.id)}
                  className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-colors ${
                    on ? "bg-[var(--p-teal)] text-white" : "border border-[var(--p-border)] bg-white text-[var(--p-text)] hover:border-[var(--p-teal)]"
                  }`}
                >
                  <TabDot done={done} dirty={!!st?.dirty} on={on} />
                  <span className="max-w-[15ch] truncate">{t.testName}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* ── the numbers ── */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {!active || active.loading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-[13px] text-[var(--p-muted)]"><Spinner size={14} /> Opening the sheet…</div>
          ) : active.error && !active.sheet ? (
            <p className="py-10 text-center text-[13px] text-[var(--p-rose)]">{active.error}</p>
          ) : active.rows.length === 0 ? (
            <p className="py-10 text-center text-[13px] text-[var(--p-muted)]">
              No analyte template for this test yet. Add a line below to record the reading.
            </p>
          ) : (
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wide text-[var(--p-muted)]">
                  <th className="pb-2 pr-2 font-semibold">Analyte</th>
                  <th className="w-[104px] pb-2 pr-2 font-semibold">Value</th>
                  <th className="w-[78px] pb-2 pr-2 font-semibold">Unit</th>
                  <th className="w-[142px] pb-2 pr-2 font-semibold">Normal range</th>
                  <th className="w-[66px] pb-2 pr-2 font-semibold">Flag</th>
                  <th className="w-[22px] pb-2" />
                </tr>
              </thead>
              <tbody>
                {active.rows.map((r, i) => {
                  const f = liveFlag(r.value, r.refLow, r.refHigh);
                  return (
                    <tr key={i} className="border-t border-[var(--p-border)]">
                      <td className="py-2 pr-2">
                        <input value={r.name} onChange={(e) => setRow(i, { name: e.target.value })}
                          className="w-full bg-transparent text-[13px] font-medium text-[var(--p-ink)] outline-none" />
                        {/* The same reference note the printed report carries,
                            shown at the bench: it is worth most to whoever is
                            deciding whether a value they just typed looks
                            plausible for the analyte in front of them. */}
                        {analyteDescription(r.name) && (
                          <span className="mt-0.5 block text-[10.5px] italic leading-snug text-[var(--p-muted)]">
                            {analyteDescription(r.name)}
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-2">
                        <input value={r.value} onChange={(e) => setRow(i, { value: e.target.value })}
                          placeholder="-" autoFocus={i === 0}
                          className="w-full rounded-lg border border-[var(--p-border)] bg-white px-2.5 py-1.5 font-mono text-[13px] text-[var(--p-ink)] outline-none focus:border-[var(--p-teal)]" />
                      </td>
                      <td className="py-2 pr-2">
                        <input value={r.unit ?? ""} onChange={(e) => setRow(i, { unit: e.target.value || null })}
                          placeholder="unit" aria-label={`Unit for ${r.name || "this line"}`}
                          className="w-full rounded-lg border border-[var(--p-border)] bg-white px-2 py-1.5 font-mono text-[12px] text-[var(--p-ink)] outline-none focus:border-[var(--p-teal)]" />
                      </td>

                      {/* THE NORMAL RANGE, EDITABLE.
                          The catalogue's template is a starting point, not the
                          law: a paediatric sample, a method change or an
                          analyser's own insert can all move the band this
                          particular result must be judged against. Whatever is
                          typed here is SNAPSHOT onto the row at save time, so
                          the report keeps the range it was graded on for good. */}
                      <td className="py-2 pr-2">
                        <div className="flex items-center gap-1">
                          <input value={r.refLow ?? ""} onChange={(e) => setRow(i, { refLow: e.target.value.trim() || null })}
                            placeholder="low" inputMode="decimal" aria-label={`Low reference for ${r.name || "this line"}`}
                            className="w-full min-w-0 rounded-lg border border-[var(--p-border)] bg-white px-1.5 py-1.5 font-mono text-[12px] text-[var(--p-ink)] outline-none focus:border-[var(--p-teal)]" />
                          <span className="text-[11px] text-[var(--p-muted)]">–</span>
                          <input value={r.refHigh ?? ""} onChange={(e) => setRow(i, { refHigh: e.target.value.trim() || null })}
                            placeholder="high" inputMode="decimal" aria-label={`High reference for ${r.name || "this line"}`}
                            className="w-full min-w-0 rounded-lg border border-[var(--p-border)] bg-white px-1.5 py-1.5 font-mono text-[12px] text-[var(--p-ink)] outline-none focus:border-[var(--p-teal)]" />
                        </div>
                        {/* A range no pair of numbers can hold - "Negative",
                            "Nil", "Straw coloured". Offered only when the
                            numeric pair is empty, so the two can never both be
                            filled in and disagree on the printed report. */}
                        {r.refLow == null && r.refHigh == null && (
                          <input value={r.refText ?? ""} onChange={(e) => setRow(i, { refText: e.target.value || null })}
                            placeholder="or text, e.g. Negative" aria-label={`Reference text for ${r.name || "this line"}`}
                            className="mt-1 w-full rounded-lg border border-[var(--p-border)] bg-white px-1.5 py-1 text-[11px] text-[var(--p-ink)] outline-none focus:border-[var(--p-teal)]" />
                        )}
                      </td>
                      <td className="py-2 pr-2">
                        {f && f !== "NORMAL" ? (
                          <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${FLAG_STYLE[f]}`}>{f}</span>
                        ) : f === "NORMAL" ? (
                          <span className="text-[11px] text-[var(--p-muted)]">normal</span>
                        ) : r.value.trim() ? (
                          /* A value no range can grade - "Positive", "Growth
                             seen", "Nil". Only the lab can say whether it is
                             abnormal, and until it could, every one of these
                             was stored as NORMAL and printed as if it were. */
                          <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-[var(--p-muted)]">
                            <input type="checkbox" checked={r.flag === "ABNORMAL"}
                              onChange={(e) => setRow(i, { flag: e.target.checked ? "ABNORMAL" : "NORMAL" })} />
                            abnormal
                          </label>
                        ) : null}
                      </td>
                      {/* A line off the sheet - an analyte the template lists
                          but this sample was never run for, or a line added by
                          mistake. Removing it here is the only way to say so:
                          left blank it is dropped at save anyway, silently, and
                          a technician who can't see that happen assumes the
                          empty row is still expected of them. */}
                      <td className="py-2 align-top">
                        <button
                          onClick={() => removeRow(i)}
                          aria-label={`Remove ${r.name || "this line"}`}
                          title="Remove this line"
                          className="mt-1.5 flex h-5 w-5 items-center justify-center rounded text-[13px] leading-none text-[var(--p-muted)] transition-colors hover:bg-[var(--p-rose-soft)] hover:text-[var(--p-rose)]">
                          ×
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {active?.sheet && (
            <button onClick={addRow}
              className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-medium text-[var(--p-teal)]">
              <Icon name="plus" size={12} /> Add a line
            </button>
          )}
        </div>

        {/* The bench's read of its own numbers. Written here rather than on a
            separate screen because it is only trustworthy when it is written
            WITH the values in front of you, in one action. Per tab: an
            impression belongs to the test it describes, never to the panel. */}
        {active?.sheet && (
          <div className="mx-6 mb-4 flex flex-col gap-4 sm:flex-row sm:items-start">
            <div className="flex-1">
              <label className="text-[11px] font-semibold uppercase tracking-wide text-[var(--p-muted)]">
                Impression / diagnosis from these results
              </label>
              <textarea
                value={active.impression}
                onChange={(e) => patch(activeId, { impression: e.target.value, dirty: true })}
                maxLength={600}
                placeholder="What these numbers show - e.g. Microcytic hypochromic anaemia. Suggest serum ferritin."
                className="mt-1.5 min-h-[64px] w-full resize-y rounded-lg border border-[var(--p-border)] bg-white px-3 py-2 text-[13px] leading-relaxed text-[var(--p-ink)] outline-none focus:border-[var(--p-teal)]"
              />
              <p className="mt-1 text-[11px] leading-relaxed text-[var(--p-muted)]">
                Optional, and about <span className="font-semibold">{activeTab.testName}</span> alone. Goes onto the
                patient&apos;s OPD sheet under <span className="font-semibold">Investigation</span>, attributed to the lab.
                The consulting doctor&apos;s diagnosis is separate and this never replaces it.
                {active.sheet.test.impression && active.sheet.test.technicianName && (
                  <> Currently written by <span className="font-semibold">{active.sheet.test.technicianName}</span>.</>
                )}
              </p>
            </div>
            <div className="w-full shrink-0 sm:w-56">
              <label className="text-[11px] font-semibold uppercase tracking-wide text-[var(--p-muted)]">
                Reported Date &amp; Time
              </label>
              <input
                type="datetime-local"
                value={active.completedAt}
                onChange={(e) => patch(activeId, { completedAt: e.target.value, dirty: true })}
                className="mt-1.5 w-full rounded-lg border border-[var(--p-border)] bg-white px-3 py-2 text-[13px] text-[var(--p-ink)] outline-none focus:border-[var(--p-teal)]"
              />
              <p className="mt-1 text-[11px] leading-relaxed text-[var(--p-muted)]">
                {active.completedAt && formatDateTimeAmPm(active.completedAt) ? (
                  <>Prints as: <span className="font-semibold text-[var(--p-teal-deep)]">{formatDateTimeAmPm(active.completedAt)}</span></>
                ) : (
                  "Date & time printed on the report sheet (with AM/PM)."
                )}
              </p>
            </div>
          </div>
        )}

        {active?.error && active.sheet && (
          <p className="mx-6 mb-3 rounded-lg bg-[var(--p-rose-soft)] px-3 py-2 text-[12px] text-[var(--p-rose)]">{active.error}</p>
        )}

        <p className="mx-6 mb-3 rounded-lg bg-[var(--p-teal-soft)] px-3 py-2 text-[12px] leading-relaxed text-[var(--p-teal-deep)]">
          Saving marks <span className="font-semibold">this test</span> completed and stamps your name on it. Each tab is
          saved on its own, so a panel can be released as each result comes off the analyser. Every column here is yours to
          edit - analyte, unit and normal range included - and lines can be added or removed for what this sample actually
          ran. What you save is snapshot onto the result, so a later change to the catalogue can&apos;t re-grade a report
          already given out.
        </p>

        {/* ── close guard ── */}
        {confirmClose && (
          <div className="mx-6 mb-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--p-amber)]/30 bg-[var(--p-amber-soft)] px-3 py-2.5 text-[12px] text-[#8a6414]">
            <span className="flex items-center gap-1.5">
              <Icon name="alert" size={14} />
              {dirtyCount === 1 ? "One test has values you haven't saved." : `${dirtyCount} tests have values you haven't saved.`}
            </span>
            <span className="flex items-center gap-2">
              <button onClick={() => setConfirmClose(false)} className="font-semibold text-[#8a6414] underline">Keep editing</button>
              <button onClick={onClose} className="rounded-lg border border-[#8a6414]/30 bg-white px-3 py-1 font-semibold text-[#8a6414]">Discard &amp; close</button>
            </span>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-[var(--p-border)] p-5">
          {savedCount > 0 && (
            <span className="mr-auto inline-flex items-center gap-1.5 text-[13px] font-semibold text-[var(--p-teal-deep)]">
              <Icon name="check" size={15} />
              {savedCount === 1 ? "1 test saved" : `${savedCount} tests saved`}
              {tabs.length > 1 && <span className="font-normal text-[var(--p-muted)]"> of {tabs.length}</span>}
            </span>
          )}

          {(active?.savedNow || activeTab.status === "COMPLETED") && (
            /* Reprinting a report already on file needs no save - the sheet is a
               live view of the stored values, not a snapshot taken here. */
            <a href={`/labs/print/lab/${activeId}`} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--p-border)] px-4 py-2 text-sm font-medium text-[var(--p-text)] transition-colors hover:border-[var(--p-teal)] hover:text-[var(--p-teal)]">
              <Icon name="file" size={14} /> Print {doneCount > 1 ? "this one" : "report"}
            </a>
          )}

          {/* The whole order in one job, one sheet per test. Offered from the
              second released test onward: before that it is the same single
              sheet as the button beside it, under a name that promises more. */}
          {doneCount > 1 && (
            <a href={`/labs/print/lab-order/${orderId}`} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--p-teal)]/40 bg-[var(--p-teal-soft)] px-4 py-2 text-sm font-semibold text-[var(--p-teal-deep)] transition-colors hover:bg-[var(--p-teal)] hover:text-white">
              <Icon name="file" size={14} /> Print all {doneCount}
            </a>
          )}

          <button onClick={requestClose} className="rounded-lg border border-[var(--p-border)] px-4 py-2 text-sm text-[var(--p-text)]">
            {active?.savedNow ? "Close" : "Cancel"}
          </button>

          {nextPending ? (
            <>
              <button onClick={() => save(false)} disabled={saving || !active?.sheet}
                className="rounded-lg border border-[var(--p-border)] px-4 py-2 text-sm text-[var(--p-text)] transition-colors hover:border-[var(--p-teal)] disabled:opacity-50">
                {saving ? "Saving…" : "Save"}
              </button>
              <PrimaryButton onClick={() => save(true)} disabled={saving || !active?.sheet}>
                {saving ? <><Spinner /> Saving…</> : <><Icon name="check" size={15} /> Save &amp; next: {truncate(nextPending.testName)}</>}
              </PrimaryButton>
            </>
          ) : (
            <PrimaryButton onClick={() => save(false)} disabled={saving || !active?.sheet}>
              {saving ? <><Spinner /> Saving…</> : <><Icon name="check" size={15} /> {active?.savedNow ? "Save changes" : "Save results"}</>}
            </PrimaryButton>
          )}
        </div>
      </div>
    </div>
  );
}

/** Where a tab stands, at a glance: done, half-typed, or not started. */
function TabDot({ done, dirty, on }: { done: boolean; dirty: boolean; on: boolean }) {
  if (done) return <Icon name="check" size={12} />;
  return (
    <span className={`h-1.5 w-1.5 rounded-full ${
      dirty ? "bg-[var(--p-amber)]" : on ? "bg-white/60" : "bg-[var(--p-border)]"
    }`} />
  );
}

const truncate = (s: string) => (s.length > 18 ? `${s.slice(0, 17)}…` : s);

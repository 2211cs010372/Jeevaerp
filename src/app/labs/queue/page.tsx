"use client";

/**
 * THE BENCH QUEUE - ONE ROW PER ORDER.
 *
 * What was picked in a single submit is one job: one patient, one sample, one
 * row, however many tests it covers. The flat list this replaces drew a CBP, an
 * LFT and a TSH taken from the same tube as three unrelated rows, and the only
 * way to see they were one patient's was to read the name three times.
 *
 * The tests stay individually actionable INSIDE the order, because they finish
 * separately: an LFT off the analyser at 11:00 is released while the culture
 * ordered with it is still growing. So the row expands, and each test keeps its
 * own report upload, its own print and its own done.
 */

import { useEffect, useRef, useState } from "react";
import { Pill, statusTone } from "@/components/portal/ui/primitives";
import { Icon } from "@/components/portal/ui/icons";
import { Spinner } from "@/components/portal/ui/form-atoms";
import { PortalScroll } from "@/components/portal/portal-scroll";
import { ResultSheet, type SavedTest, type SheetTest } from "@/components/portal/labs/result-sheet";
import { OrderEditPanel } from "@/components/portal/labs/order-edit-panel";
import { useDoctorRoster } from "@/components/portal/labs/referrer-select";
import { api, ApiClientError } from "@/lib/api-client";
import { useLive } from "@/lib/realtime/use-live";
import { TOPICS } from "@/lib/realtime/topics";

import { useDebounce } from "@/lib/use-debounce";
import { Pagination } from "@/components/portal/ui/pagination";
import { useMemo } from "react";

interface Test {
  id: string; testName: string; status: string; price: string | null; reportFileUrl: string | null;
  createdAt: string; completedAt: string | null; billed: boolean;
  patient: { id: string; displayId: string; fullName: string; phone: string } | null;
  appointment: { opNumber: string; doctorName: string; visitDate: string } | null;
  /** The bench's read of these results, once written. */
  impression: string | null;
}

/** Everything picked in one submit - see listLabOrders on the server. */
interface Order {
  id: string; createdAt: string; status: string; pending: number;
  total: string | null; billed: boolean;
  /** The desk's correction to the registration date, when it made one. */
  orderedAt: string | null;
  patient: { id: string; displayId: string; fullName: string; phone: string } | null;
  appointment: { opNumber: string; doctorName: string; visitDate: string } | null;
  /** Named on the order when no consultation here named a doctor. */
  referringDoctor: { id: string; name: string } | null;
  tests: Test[];
}

/** "4 Aug" - the registered-on date as the queue shows it. */
const dayMonth = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });

/** Which test the sheet opens on, and the order it belongs to. */
interface SheetTarget { orderId: string; tests: SheetTest[]; openAt: string }

export default function LabQueuePage() {
  const [filter, setFilter] = useState<"PENDING" | "COMPLETED" | "ALL">("PENDING");
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  /** The order whose doctor / date correction panel is open, if any. */
  const [editing, setEditing] = useState<string | null>(null);
  const doctors = useDoctorRoster();
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const [q, setQ] = useState("");
  const debouncedQ = useDebounce(q, 300);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const filteredOrders = useMemo(() => {
    const needle = debouncedQ.trim().toLowerCase();
    if (!needle) return orders;
    return orders.filter((o) => {
      const pName = (o.patient?.fullName ?? "").toLowerCase();
      const pId = (o.patient?.displayId ?? "").toLowerCase();
      const pPhone = (o.patient?.phone ?? "").toLowerCase();
      const docName = (o.appointment?.doctorName ?? o.referringDoctor?.name ?? "").toLowerCase();
      const opNum = (o.appointment?.opNumber ?? "").toLowerCase();
      const testNames = o.tests.map((t) => t.testName.toLowerCase()).join(" ");
      return pName.includes(needle) || pId.includes(needle) || pPhone.includes(needle) || docName.includes(needle) || opNum.includes(needle) || testNames.includes(needle);
    });
  }, [orders, debouncedQ]);

  useEffect(() => {
    setPage(1);
  }, [debouncedQ, filter, pageSize]);

  const totalPages = Math.ceil(filteredOrders.length / pageSize) || 1;
  const pagedOrders = useMemo(() => {
    return filteredOrders.slice((page - 1) * pageSize, page * pageSize);
  }, [filteredOrders, page, pageSize]);

  /** The order the result sheet is open on, and the tab it opened at. */
  const [sheet, setSheet] = useState<SheetTarget | null>(null);

  /**
   * The tests whose results were saved in the sitting that just ended. Kept so
   * the banner can offer each printed report in the same breath - entering
   * results and handing the patient the sheets is ONE job at the counter, and
   * making the technician hunt their own rows back out of the list to print them
   * is how reports end up not being printed at all. An order saves several tests
   * in one sitting, so this is a list - and once it holds more than one, the
   * whole order goes out as a single print job rather than as N of them.
   */
  const [justSaved, setJustSaved] = useState<{ orderId: string; tests: SavedTest[]; patientName: string } | null>(null);

  async function load(quiet = false) {
    if (!quiet) setLoading(true);
    try {
      const q = filter === "ALL" ? "" : `?status=${filter}`;
      const { orders } = await api.get<{ orders: Order[] }>(`/labs/orders${q}`);
      setOrders(orders);
    } catch { if (!quiet) setOrders([]); } finally { if (!quiet) setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [filter]);

  // An order raised at reception appears here while the sample is still being
  // collected. Suspended while a result sheet or a correction panel is open so
  // typing is never interrupted by the list reloading underneath.
  useLive([TOPICS.LABS], () => load(true), { enabled: !sheet && !editing });

  /** Open the sheet on one test, with the rest of its order as tabs. */
  function openSheet(order: Order, testId?: string) {
    setError(null);
    setJustSaved(null);
    // Default to the first test still owed - that is the one being worked on.
    const start = testId ?? (order.tests.find((t) => t.status === "PENDING") ?? order.tests[0]).id;
    setSheet({ orderId: order.id, tests: order.tests.map(toSheetTest), openAt: start });
  }

  function toggle(id: string) {
    setExpanded((e) => { const n = new Set(e); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }

  function onSaved(saved: SavedTest, patientName: string) {
    const orderId = sheet?.orderId ?? saved.id;
    setJustSaved((j) => ({
      orderId,
      patientName,
      // A second save from a DIFFERENT order starts the list over - the combined
      // print below is one order's document and can't span two.
      tests: [...(j?.orderId === orderId ? j.tests.filter((t) => t.id !== saved.id) : []), saved],
    }));
    load(true);
  }

  async function complete(id: string) {
    setError(null); setBusyId(id);
    try { await api.post("/labs/tests/complete", { labTestId: id }); await load(); }
    catch (e) { setError(e instanceof ApiClientError ? e.message : "Could not complete the test."); }
    finally { setBusyId(null); }
  }

  async function removeReport(id: string) {
    setError(null); setBusyId(id);
    try { await api.post("/labs/tests/report/remove", { labTestId: id }); await load(); }
    catch (e) { setError(e instanceof ApiClientError ? e.message : "Could not remove the report."); }
    finally { setBusyId(null); }
  }

  async function uploadReport(id: string, file: File) {
    setError(null); setBusyId(id);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("labTestId", id);
      const res = await fetch("/api/v1/labs/tests/report", { method: "POST", body: form, credentials: "same-origin" });
      const body = await res.json();
      if (!res.ok) throw new ApiClientError(res.status, body.error ?? "Upload failed");
      await load();
    } catch (e) { setError(e instanceof ApiClientError ? e.message : "Upload failed."); }
    finally { setBusyId(null); }
  }

  /** The per-test controls, identical whether the order holds one test or ten. */
  function testActions(t: Test) {
    return (
      <>
        {t.reportFileUrl && (
          <a href={t.reportFileUrl} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--p-border)] px-3 py-1.5 text-[12px] font-medium text-[var(--p-teal)] transition-colors hover:border-[var(--p-teal)]">
            <Icon name="file" size={13} /> Report
          </a>
        )}

        {t.status === "COMPLETED" ? (
          <>
            {/* The hospital's own report sheet, built from the values on file -
                not the uploaded file, which is whatever an outside lab sent. */}
            <a href={`/labs/print/lab/${t.id}`} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--p-border)] px-3 py-1.5 text-[12px] font-medium text-[var(--p-text)] transition-colors hover:border-[var(--p-teal)] hover:text-[var(--p-teal)]">
              <Icon name="file" size={13} /> Print report
            </a>
            <input
              ref={(el) => { fileRefs.current[t.id] = el; }}
              type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadReport(t.id, f); }}
            />
            <button onClick={() => fileRefs.current[t.id]?.click()} disabled={busyId === t.id}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--p-border)] px-3 py-1.5 text-[12px] font-medium text-[var(--p-text)] transition-colors hover:border-[var(--p-teal)] hover:text-[var(--p-teal)] disabled:opacity-60">
              {busyId === t.id ? <Spinner size={12} /> : <Icon name="file" size={13} />} Replace
            </button>
            {t.reportFileUrl && (
              <button onClick={() => removeReport(t.id)} disabled={busyId === t.id}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--p-rose)]/30 px-3 py-1.5 text-[12px] font-medium text-[var(--p-rose)] transition-colors hover:bg-[var(--p-rose-soft)] disabled:opacity-60">
                <Icon name="alert" size={13} /> Remove
              </button>
            )}
          </>
        ) : (
          <>
            <input
              ref={(el) => { fileRefs.current[t.id] = el; }}
              type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadReport(t.id, f); }}
            />
            <button onClick={() => fileRefs.current[t.id]?.click()} disabled={busyId === t.id}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--p-teal)] px-3 py-1.5 text-[12px] font-semibold text-white transition-colors hover:bg-[var(--p-teal-deep)] disabled:opacity-60">
              {busyId === t.id ? <Spinner size={12} /> : <Icon name="file" size={13} />} Upload report
            </button>
            <button onClick={() => complete(t.id)} disabled={busyId === t.id}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--p-border)] px-3 py-1.5 text-[12px] font-medium text-[var(--p-text)] transition-colors hover:border-[var(--p-teal)] hover:text-[var(--p-teal)] disabled:opacity-60">
              <Icon name="check" size={13} /> Mark done
            </button>
          </>
        )}
      </>
    );
  }

  return (
    <PortalScroll>
      <div data-rise className="surface dotgrid mb-6 flex flex-wrap items-center justify-between gap-4 px-6 py-5">
        <div>
          <h1 className="font-serif-p text-[22px] font-semibold text-[var(--p-ink)]">Test queue</h1>
          <p className="mt-1 text-[13px] text-[var(--p-muted)]">
            One row per order. Open it to enter results for every test on it, switching between them as each comes off.
          </p>
        </div>
        <div className="flex gap-1 rounded-md border border-[var(--p-border)] bg-white p-1">
          {(["PENDING", "COMPLETED", "ALL"] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)}
              className={`rounded-full px-3.5 py-1.5 text-[12px] font-semibold transition-colors ${filter === f ? "bg-[var(--p-teal)] text-white" : "text-[var(--p-muted)] hover:text-[var(--p-ink)]"}`}>
              {f === "ALL" ? "All" : f.charAt(0) + f.slice(1).toLowerCase()}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div data-rise className="mb-4 flex items-start gap-2 rounded-lg border border-[var(--p-rose)]/25 bg-[var(--p-rose-soft)] px-4 py-3 text-[13px] text-[var(--p-rose)]">
          <Icon name="alert" size={15} /> <span>{error}</span>
        </div>
      )}

      <div data-rise className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[240px] flex-1">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search patient name, Jeeva ID, phone, test name, doctor..."
            className="w-full rounded-lg border border-[var(--p-border)] bg-white px-3.5 py-2 text-sm text-[var(--p-ink)] outline-none transition-colors focus:border-[var(--p-teal)]"
          />
        </div>
      </div>

      {/* Saved, and every report is one click away. Not auto-opened: a popup
          fired from a save is the first thing a browser blocks, and a technician
          who gets nothing when they expected a report assumes the save failed. */}
      {justSaved && !sheet && (
        <div data-rise className="mb-4 rounded-lg border border-[var(--p-teal)]/25 bg-[var(--p-teal-soft)] px-4 py-3 text-[13px] text-[var(--p-teal-deep)]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="flex items-center gap-2">
              <Icon name="check" size={15} />
              Results saved for {justSaved.patientName} · {justSaved.tests.length} test{justSaved.tests.length === 1 ? "" : "s"}.
            </span>
            <button onClick={() => setJustSaved(null)} className="text-[12px] font-medium text-[var(--p-teal-deep)]/70 hover:text-[var(--p-teal-deep)]">
              Dismiss
            </button>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {/* Several results from one sample: ONE job, one sheet per test.
                Leading the row because handing the patient the whole order is
                the thing they are waiting at the counter for - the single
                prints beside it are for a re-run of one sheet. */}
            {justSaved.tests.length > 1 && (
              <a href={`/labs/print/lab-order/${justSaved.orderId}`} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--p-teal)] px-3 py-1.5 text-[12px] font-semibold text-white transition-colors hover:bg-[var(--p-teal-deep)]">
                <Icon name="file" size={13} /> Print all {justSaved.tests.length} reports
              </a>
            )}
            {justSaved.tests.map((t) => (
              <a key={t.id} href={`/labs/print/lab/${t.id}`} target="_blank" rel="noopener noreferrer"
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-colors ${
                  justSaved.tests.length > 1
                    ? "border border-[var(--p-teal)]/40 bg-white text-[var(--p-teal-deep)] hover:bg-[var(--p-teal-soft)]"
                    : "bg-[var(--p-teal)] text-white hover:bg-[var(--p-teal-deep)]"
                }`}>
                <Icon name="file" size={13} /> Print {t.testName}
              </a>
            ))}
          </div>
        </div>
      )}

      <section data-rise className="surface overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-20 text-[13px] text-[var(--p-muted)]"><Spinner /> Loading orders…</div>
        ) : filteredOrders.length === 0 ? (
          <div className="dotgrid flex flex-col items-center py-20 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full border border-[var(--p-border)] bg-white text-[var(--p-muted)]"><Icon name="flask" size={20} /></span>
            <p className="mt-3 text-[13px] text-[var(--p-muted)]">{q.trim() ? "Nothing matches that search." : `No ${filter === "ALL" ? "" : filter.toLowerCase()} orders.`}</p>
          </div>
        ) : (
          <div className="divide-y divide-[var(--p-border)]">
            {pagedOrders.map((o) => {
              const many = o.tests.length > 1;
              const open = expanded.has(o.id);
              // An order of one is drawn as the test it is - an expander that
              // reveals a single row is a click that buys nothing.
              const single = many ? null : o.tests[0];
              return (
                <div key={o.id} className="transition-colors hover:bg-[var(--p-bg)]">
                  <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4">
                    <div className="min-w-[240px]">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[14px] font-medium text-[var(--p-ink)]">
                          {single ? single.testName : `${o.tests.length} tests`}
                        </span>
                        {o.billed && <span className="badge !py-0.5 !text-[10px]">billed</span>}
                      </div>
                      <div className="mt-0.5 text-[12px] text-[var(--p-muted)]">
                        {o.patient?.fullName ?? "-"} · <span className="tabular">{o.patient?.displayId ?? "-"}</span>
                        {/* Who the report will name as Ref. Doctor - the visit's
                            doctor, else whoever the desk wrote on the order,
                            else nobody at all. */}
                        {o.appointment
                          ? ` · ${o.appointment.doctorName} (${o.appointment.opNumber})`
                          : o.referringDoctor ? ` · ref. ${o.referringDoctor.name}` : " · walk-in"}
                        {" · "}<span className="tabular">{dayMonth(o.orderedAt ?? o.createdAt)}</span>
                        {/* A corrected date says so, next to the date it replaced
                            - a back-dated order that reads like an ordinary one
                            is impossible to check against the register. */}
                        {o.orderedAt && <span className="italic"> (typed in {dayMonth(o.createdAt)})</span>}
                      </div>

                      {/* What is actually on the order, without opening it -
                          "3 tests" alone tells the bench nothing about whether
                          the sample in their hand is the right one. */}
                      {many && (
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {o.tests.map((t) => (
                            <button key={t.id} onClick={() => openSheet(o, t.id)}
                              className={`rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors ${
                                t.status === "COMPLETED"
                                  ? "border-[var(--p-teal)]/30 bg-[var(--p-teal-soft)] text-[var(--p-teal-deep)]"
                                  : "border-[var(--p-border)] bg-white text-[var(--p-text)] hover:border-[var(--p-teal)]"
                              }`}>
                              {t.status === "COMPLETED" && "✓ "}{t.testName}
                            </button>
                          ))}
                        </div>
                      )}

                      {/* Shown on the row, not hidden behind the sheet: a queue
                          that makes you open every test to find the one that was
                          flagged is a queue nobody reads. */}
                      {o.tests.filter((t) => t.impression).map((t) => (
                        <p key={t.id} className="mt-1 max-w-[46ch] text-[12px] italic leading-snug text-[var(--p-teal-deep)]">
                          {many && <span className="not-italic font-semibold">{t.testName}: </span>}{t.impression}
                        </p>
                      ))}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {o.total && <span className="font-mono text-[12px] text-[var(--p-muted)]">₹{o.total}</span>}
                      {/* Every released report on the order, one job, one sheet
                          each. Offered as soon as ONE test is done, because a
                          patient waiting on the last of four still leaves with
                          the three that are ready. */}
                      {many && o.pending < o.tests.length && (
                        <a href={`/labs/print/lab-order/${o.id}`} target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--p-border)] px-3 py-1.5 text-[12px] font-medium text-[var(--p-text)] transition-colors hover:border-[var(--p-teal)] hover:text-[var(--p-teal)]">
                          <Icon name="file" size={13} /> Print all ({o.tests.length - o.pending})
                        </a>
                      )}
                      <Pill tone={statusTone(o.status === "PENDING" ? "Waiting" : "Completed")}>
                        {o.status === "PENDING"
                          ? many ? `${o.pending} of ${o.tests.length} pending` : "Pending"
                          : "Completed"}
                      </Pill>

                      {/* The numbers themselves - what makes a result readable by
                          a screen. Opens on the ORDER: every test on it is a tab. */}
                      <button onClick={() => openSheet(o)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--p-teal)]/40 bg-[var(--p-teal-soft)] px-3 py-1.5 text-[12px] font-semibold text-[var(--p-teal-deep)] transition-colors hover:bg-[var(--p-teal)] hover:text-white">
                        <Icon name="flask" size={13} /> {o.status === "PENDING" ? "Enter results" : "Results"}
                      </button>

                      {/* THE CHIT NOBODY TYPED IN, AND THE DAY THAT WAS WRONG.
                          An order with no doctor on it is called out rather
                          than left to be noticed: it prints "Self / walk-in" on
                          a report that goes back to the doctor who asked for
                          it, and this row is the last place anyone sees it
                          before that happens. */}
                      {(() => {
                        const noDoctor = !o.appointment && !o.referringDoctor;
                        return (
                          <button onClick={() => setEditing(editing === o.id ? null : o.id)}
                            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12px] font-medium transition-colors ${
                              noDoctor
                                ? "border-[var(--p-amber)]/40 bg-[var(--p-amber-soft)] text-[#8a6414] hover:border-[var(--p-amber)]"
                                : "border-[var(--p-border)] text-[var(--p-text)] hover:border-[var(--p-teal)] hover:text-[var(--p-teal)]"
                            }`}>
                            <Icon name="calendar" size={13} />
                            {editing === o.id ? "Close" : noDoctor ? "Add doctor / date" : "Doctor & date"}
                          </button>
                        );
                      })()}

                      {single ? testActions(single) : (
                        <button onClick={() => toggle(o.id)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--p-border)] px-3 py-1.5 text-[12px] font-medium text-[var(--p-text)] transition-colors hover:border-[var(--p-teal)] hover:text-[var(--p-teal)]">
                          {open ? "Hide tests" : "Reports & status"} {open ? "▴" : "▾"}
                        </button>
                      )}
                    </div>
                  </div>

                  {editing === o.id && (
                    <OrderEditPanel
                      order={o}
                      doctors={doctors}
                      onClose={() => setEditing(null)}
                      onSaved={() => { setEditing(null); load(true); }}
                    />
                  )}

                  {/* Each test finishes on its own clock, so each keeps its own
                      upload, print and done - just one level in. */}
                  {many && open && (
                    <div className="border-t border-dashed border-[var(--p-border)] bg-[var(--p-bg)] px-6 py-1">
                      {o.tests.map((t) => (
                        <div key={t.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--p-border)] py-3 last:border-b-0">
                          <div className="flex items-center gap-2">
                            <span className="text-[13px] font-medium text-[var(--p-ink)]">{t.testName}</span>
                            {t.price && <span className="font-mono text-[11px] text-[var(--p-muted)]">₹{t.price}</span>}
                            <Pill tone={statusTone(t.status === "PENDING" ? "Waiting" : "Completed")}>
                              {t.status === "PENDING" ? "Pending" : "Completed"}
                            </Pill>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <button onClick={() => openSheet(o, t.id)}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--p-teal)]/40 px-3 py-1.5 text-[12px] font-semibold text-[var(--p-teal-deep)] transition-colors hover:bg-[var(--p-teal-soft)]">
                              <Icon name="flask" size={13} /> {t.status === "PENDING" ? "Enter results" : "Results"}
                            </button>
                            {testActions(t)}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {!loading && filteredOrders.length > 0 && (
          <Pagination
            page={page}
            totalPages={totalPages}
            totalItems={filteredOrders.length}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
            itemLabel="orders"
          />
        )}
      </section>

      {sheet && (
        <ResultSheet
          key={sheet.openAt}
          orderId={sheet.orderId}
          tests={sheet.tests}
          openAt={sheet.openAt}
          onClose={() => setSheet(null)}
          onSaved={onSaved}
        />
      )}
    </PortalScroll>
  );
}

const toSheetTest = (t: Test): SheetTest => ({
  id: t.id, testName: t.testName, status: t.status, patient: t.patient,
});

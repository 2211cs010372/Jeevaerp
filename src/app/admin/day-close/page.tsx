"use client";

import { useCallback, useEffect, useState } from "react";
import { Spinner } from "@/components/portal/ui/form-atoms";
import { Icon } from "@/components/portal/ui/icons";
import { PortalScroll } from "@/components/portal/portal-scroll";
import { api, ApiClientError } from "@/lib/api-client";
import { useLive } from "@/lib/realtime/use-live";
import { EVENTS, TOPICS } from "@/lib/realtime/topics";

interface ModeTotal { mode: string; collected: number; refunded: number; net: number; count: number; }
interface Close {
  date: string;
  modes: ModeTotal[];
  totals: { collected: number; refunded: number; net: number };
  cashInHand: number;
  bills: number;
  refundCount: number;
  byCounter: { name: string; count: number; amount: number }[];
  refunds: { receiptNo: string; patient: string; amount: number; mode: string; reason: string; by: string; at: string }[];
  outstanding: { receiptNo: string; patient: string; total: number; paid: number; due: number }[];
  /** Billed to insurers today. Reported here, absent from every total above. */
  insurance: { receiptNo: string; patient: string; insurer: string | null; total: number }[];
  insuranceTotal: number;
}

interface SourceTotal { source: string; collected: number; refunded: number; net: number; count: number; }
interface TillSummary {
  till: string; label: string;
  collected: number; refunded: number; net: number;
  cash: number; digital: number;
  payments: number; bills: number;
  insuranceBills: number; insuranceAmount: number;
  staff: { name: string; count: number; amount: number }[];
  bySource: SourceTotal[];
}
interface ByTill {
  date: string;
  tills: TillSummary[];
  totals: {
    collected: number; refunded: number; net: number; cash: number; payments: number; bills: number;
    insuranceBills: number; insuranceAmount: number;
  };
}

const money = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const round = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");
const todayISO = () => new Date().toLocaleDateString("en-CA");

const SOURCE_LABEL: Record<string, string> = {
  CONSULTATION: "Consultation", PHARMACY: "Pharmacy", LAB: "Laboratory",
  IPD: "Inpatient stay", OTHER: "Other",
};

/** Each counter gets its own colour so the eye can follow one across the page. */
const TILL_TINT: Record<string, { bg: string; fg: string }> = {
  RECEPTION:  { bg: "var(--p-teal-soft)",  fg: "var(--p-teal-deep)" },
  PHARMACY:   { bg: "var(--p-blue-soft)",  fg: "var(--p-blue)" },
  LAB:        { bg: "var(--p-cyan-soft)",  fg: "var(--p-cyan-deep)" },
  ADMIN:      { bg: "var(--p-amber-soft)", fg: "#8a6414" },
  UNASSIGNED: { bg: "var(--p-rose-soft)",  fg: "var(--p-rose)" },
};

export default function AdminDayClosePage() {
  const [date, setDate] = useState(todayISO());
  const [data, setData] = useState<Close | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportErr, setExportErr] = useState<string | null>(null);

  const [byTill, setByTill] = useState<ByTill | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      // The hospital total and the per-counter split are fetched together so the
      // page can never show a roll-up from one day beside a total from another.
      const [all, tills] = await Promise.all([
        api.get<Close>(`/reception/day-close?till=ALL&date=${date}`),
        api.get<ByTill>(`/admin/day-close?date=${date}`),
      ]);
      setData(all); setByTill(tills);
    }
    catch (e) { setError(e instanceof ApiClientError ? e.message : "Couldn't load the day."); }
    finally { setLoading(false); }
  }, [date]);
  useEffect(() => { load(); }, [load]);

  // The owner watching the day's takings should see them move as they are taken,
  // at whichever counter took them.
  useLive([TOPICS.ADMIN], load, {
    events: [EVENTS.INVOICE_RAISED, EVENTS.PAYMENT_TAKEN],
  });

  /**
   * Excel is built from the data ALREADY on screen - not re-fetched - so the
   * workbook can never disagree with the figures the manager just read. The
   * xlsx library is ~1 MB and is imported inside the export helper on demand,
   * so opening this page doesn't pay for it.
   */
  async function downloadExcel() {
    if (!data) return;
    setExporting(true); setExportErr(null);
    try {
      const { downloadDayCloseXlsx } = await import("@/lib/export/day-close-xlsx");
      await downloadDayCloseXlsx(data);
    } catch {
      setExportErr("Could not build the Excel file. Try the PDF instead.");
    } finally { setExporting(false); }
  }

  const cash = (data?.modes ?? []).find((m) => m.mode === "CASH")?.collected ?? 0;
  const upi = (data?.modes ?? []).find((m) => m.mode === "UPI")?.collected ?? 0;
  const card = (data?.modes ?? []).find((m) => m.mode === "CARD")?.collected ?? 0;

  return (
    <PortalScroll>
      <div data-rise className="surface dotgrid mb-6 flex flex-wrap items-center justify-between gap-4 px-6 py-5">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--p-teal)]">Admin console</p>
          <h1 className="mt-1 font-serif-p text-[24px] font-semibold text-[var(--p-ink)]">Day close</h1>
          <p className="mt-1 text-[13px] text-[var(--p-muted)]">Hospital-wide collections for a day - by payment type and by counter.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)}
            className="rounded-lg border border-[var(--p-border)] bg-white px-3 py-2 text-[13px] text-[var(--p-ink)] outline-none focus:border-[var(--p-teal)]" />

          {/* Both exports are disabled until the day has actually loaded -
              a workbook built from `null` would download as an empty file that
              looks like a zero-takings day. */}
          <button onClick={downloadExcel} disabled={!data || loading || exporting}
            title="Download this day as a multi-sheet Excel workbook"
            className="inline-flex items-center gap-2 rounded-lg border border-[var(--p-border)] bg-white px-3.5 py-2 text-[13px] font-medium text-[var(--p-text)] transition-colors hover:border-[var(--p-teal)] hover:text-[var(--p-teal)] disabled:opacity-45">
            {exporting ? <><Spinner size={13} /> Building…</> : <><Icon name="grid" size={14} /> Excel</>}
          </button>

          <a href={`/print/day-close?date=${date}`} target="_blank" rel="noopener noreferrer"
            aria-disabled={!data}
            title="Open the printable statement - use Print / Save PDF"
            className={`inline-flex items-center gap-2 rounded-lg bg-[var(--p-teal)] px-3.5 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-[var(--p-teal-deep)] ${!data ? "pointer-events-none opacity-45" : ""}`}>
            <Icon name="file" size={14} /> PDF
          </a>
        </div>
      </div>

      {exportErr && (
        <div data-rise className="mb-4 flex items-center gap-2 rounded-lg border border-[var(--p-rose)]/25 bg-[var(--p-rose-soft)] px-4 py-2.5 text-[13px] text-[var(--p-rose)]">
          <Icon name="alert" size={14} /> {exportErr}
        </div>
      )}

      {error ? (
        <div data-rise className="surface flex flex-col items-center gap-3 px-6 py-16 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--p-rose-soft)] text-[var(--p-rose)]"><Icon name="alert" size={20} /></span>
          <p className="text-[15px] font-semibold text-[var(--p-ink)]">Couldn&apos;t load the day</p>
          <p className="max-w-md text-[13px] text-[var(--p-rose)]">{error}</p>
          <button onClick={() => load()} className="mt-1 rounded-lg bg-[var(--p-teal)] px-4 py-2 text-[13px] font-semibold text-white hover:bg-[var(--p-teal-deep)]">Try again</button>
        </div>
      ) : loading || !data ? (
        <div className="flex items-center justify-center gap-2 py-20 text-[13px] text-[var(--p-muted)]"><Spinner /> Loading…</div>
      ) : (
        <>
          {/* headline */}
          <div data-rise className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
            {([["Cash", cash], ["UPI", upi], ["Card", card]] as const).map(([label, v]) => (
              <div key={label} className="surface px-5 py-4">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--p-muted)]">{label} collected</div>
                <div className="mt-1 font-mono text-[20px] font-bold text-[var(--p-ink)]">₹{money(v)}</div>
              </div>
            ))}
            <div className="surface bg-[var(--p-teal-soft)]/40 px-5 py-4">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--p-teal-deep)]">Net collected</div>
              <div className="mt-1 font-mono text-[20px] font-bold text-[var(--p-teal-deep)]">₹{money(data.totals?.net ?? 0)}</div>
            </div>
          </div>

          {/* ── WHAT EACH COUNTER TOOK ──
              The owner's first question of the day, and until now the console
              couldn't answer it: the hospital total was one number with no way to
              see which window it came through. Scoped by WHO TOOK THE MONEY, so
              each row is a drawer somebody can physically count - see the Till
              note in reports.service.ts for why that differs from revenue. */}
          {byTill && byTill.tills.length > 0 && (
            <section data-rise className="surface mb-6 overflow-hidden">
              <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[var(--p-border)] px-5 py-4">
                <div>
                  <h2 className="text-[14px] font-semibold text-[var(--p-ink)]">What each counter took</h2>
                  <p className="mt-0.5 max-w-2xl text-[12px] leading-relaxed text-[var(--p-muted)]">
                    One row per drawer, by who handled the money. A bill from one department
                    settled at another&apos;s window counts as that window&apos;s cash — which is
                    what the person counting it will find.
                  </p>
                </div>
                <div className="text-right">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--p-muted)]">All counters</div>
                  <div className="font-mono text-[20px] font-bold text-[var(--p-teal-deep)]">₹{money(byTill.totals.net)}</div>
                </div>
              </div>

              <div className="divide-y divide-[var(--p-border)]">
                {byTill.tills.map((t) => {
                  const tint = TILL_TINT[t.till] ?? TILL_TINT.UNASSIGNED;
                  const share = byTill.totals.net > 0 ? (t.net / byTill.totals.net) * 100 : 0;
                  return (
                    <div key={t.till} className="px-5 py-4">
                      <div className="flex flex-wrap items-center gap-4">
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-[13px] font-bold"
                          style={{ background: tint.bg, color: tint.fg }}>
                          {t.label.slice(0, 2).toUpperCase()}
                        </span>
                        <div className="min-w-[150px] flex-1">
                          <div className="text-[14px] font-semibold text-[var(--p-ink)]">{t.label}</div>
                          <div className="text-[12px] text-[var(--p-muted)]">
                            {t.payments} payment{t.payments === 1 ? "" : "s"} · {t.bills} bill{t.bills === 1 ? "" : "s"} raised
                            {t.refunded > 0 && <span className="text-[var(--p-rose)]"> · −₹{money(t.refunded)} refunded</span>}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-[10.5px] font-semibold uppercase tracking-wide text-[var(--p-muted)]">Cash drawer</div>
                          <div className="font-mono text-[14px] font-semibold text-[var(--p-ink)]">{round(t.cash)}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-[10.5px] font-semibold uppercase tracking-wide text-[var(--p-muted)]">Digital</div>
                          <div className="font-mono text-[14px] font-semibold text-[var(--p-ink)]">{round(t.digital)}</div>
                        </div>
                        <div className="w-[130px] text-right">
                          <div className="text-[10.5px] font-semibold uppercase tracking-wide text-[var(--p-muted)]">Got</div>
                          <div className="font-mono text-[20px] font-bold" style={{ color: tint.fg }}>₹{money(t.net)}</div>
                        </div>
                      </div>

                      {/* share of the day, and what the money was for */}
                      <div className="mt-3 flex flex-wrap items-center gap-3">
                        <div className="h-1.5 min-w-[120px] flex-1 overflow-hidden rounded-full bg-[var(--p-bg)]">
                          <div className="h-full rounded-full transition-all"
                            style={{ width: `${Math.max(0, Math.min(100, share))}%`, background: tint.fg }} />
                        </div>
                        <span className="font-mono text-[11px] text-[var(--p-muted)]">{share.toFixed(1)}% of the day</span>
                        {t.bySource.length > 0 && (
                          <span className="flex flex-wrap gap-1.5">
                            {t.bySource.map((s) => (
                              <span key={s.source} className="rounded-full bg-[var(--p-bg)] px-2.5 py-0.5 text-[11px] text-[var(--p-muted)]">
                                {SOURCE_LABEL[s.source] ?? s.source} {round(s.net)}
                              </span>
                            ))}
                          </span>
                        )}
                      </div>

                      {t.staff.length > 0 && (
                        <p className="mt-2 text-[11.5px] text-[var(--p-muted)]">
                          {t.staff.map((s) => `${s.name} ${round(s.amount)}`).join(" · ")}
                        </p>
                      )}
                    </div>
                  );
                })}

                <div className="flex flex-wrap items-center gap-4 bg-[var(--p-bg)] px-5 py-3.5">
                  <span className="min-w-[150px] flex-1 text-[12px] font-bold uppercase tracking-wide text-[var(--p-muted)]">
                    Hospital total
                  </span>
                  <span className="text-right font-mono text-[13px] text-[var(--p-ink)]">
                    cash {round(byTill.totals.cash)}
                  </span>
                  <span className="w-[130px] text-right font-mono text-[18px] font-bold text-[var(--p-teal-deep)]">
                    ₹{money(byTill.totals.net)}
                  </span>
                </div>
              </div>

              {/* If a drawer can't be named, say so rather than let the money vanish
                  into a total that no longer reconciles against any one counter. */}
              {byTill.tills.some((t) => t.till === "UNASSIGNED") && (
                <div className="flex items-start gap-2 border-t border-[var(--p-border)] bg-[var(--p-rose-soft)] px-5 py-3 text-[12px] leading-relaxed text-[var(--p-rose)]">
                  <span className="mt-0.5 shrink-0"><Icon name="alert" size={14} /></span>
                  <span>
                    Some money was taken by staff who don&apos;t belong to a counter — it is counted
                    in the hospital total but nobody will be handing that drawer over. Check the
                    roles on those accounts.
                  </span>
                </div>
              )}
            </section>
          )}

          <div className="grid gap-6 lg:grid-cols-2">
            {/* by mode */}
            <section data-rise className="surface overflow-hidden">
              <div className="border-b border-[var(--p-border)] px-5 py-3.5">
                <h2 className="text-[14px] font-semibold text-[var(--p-ink)]">By payment type</h2>
                <p className="mt-0.5 text-[12px] text-[var(--p-muted)]">{data.bills} bill{data.bills === 1 ? "" : "s"} raised{data.refundCount > 0 ? ` · ${data.refundCount} refund${data.refundCount === 1 ? "" : "s"}` : ""}</p>
              </div>
              <div className="divide-y divide-[var(--p-border)]">
                {(data.modes ?? []).map((m) => (
                  <div key={m.mode} className={`flex items-center gap-4 px-5 py-3 ${m.collected === 0 && m.refunded === 0 ? "opacity-45" : ""}`}>
                    <span className="w-[90px] text-[13px] font-semibold text-[var(--p-ink)]">{m.mode}</span>
                    <span className="w-[46px] text-right font-mono text-[12px] text-[var(--p-muted)]">{m.count}×</span>
                    <span className="flex-1 text-right font-mono text-[13px] text-[var(--p-ink)]">₹{money(m.collected)}</span>
                    <span className={`w-[90px] text-right font-mono text-[13px] ${m.refunded > 0 ? "text-[var(--p-rose)]" : "text-[var(--p-muted)]"}`}>{m.refunded > 0 ? `−₹${money(m.refunded)}` : "-"}</span>
                    <span className="w-[100px] text-right font-mono text-[14px] font-bold text-[var(--p-ink)]">₹{money(m.net)}</span>
                  </div>
                ))}
                <div className="flex items-center gap-4 bg-[var(--p-bg)] px-5 py-3">
                  <span className="flex-1 text-[12px] font-bold uppercase tracking-wide text-[var(--p-muted)]">Total</span>
                  <span className="w-[100px] text-right font-mono text-[15px] font-bold text-[var(--p-teal)]">₹{money(data.totals?.net ?? 0)}</span>
                </div>
              </div>
            </section>

            {/* by counter */}
            <section data-rise className="surface overflow-hidden">
              <div className="border-b border-[var(--p-border)] px-5 py-3.5">
                <h2 className="text-[14px] font-semibold text-[var(--p-ink)]">By counter</h2>
                <p className="mt-0.5 text-[12px] text-[var(--p-muted)]">Payments taken per person.</p>
              </div>
              <div className="divide-y divide-[var(--p-border)]">
                {(data.byCounter ?? []).length === 0 ? (
                  <p className="px-5 py-8 text-center text-[13px] text-[var(--p-muted)]">No payments this day.</p>
                ) : (data.byCounter ?? []).map((c) => (
                  <div key={c.name} className="flex items-center gap-4 px-5 py-3">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--p-teal-soft)] text-[11px] font-bold text-[var(--p-teal-deep)]">
                      {c.name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase()}
                    </span>
                    <span className="flex-1 text-[13px] font-medium text-[var(--p-ink)]">{c.name}</span>
                    <span className="text-[12px] text-[var(--p-muted)]">{c.count} txn{c.count === 1 ? "" : "s"}</span>
                    <span className="w-[110px] text-right font-mono text-[14px] font-bold text-[var(--p-ink)]">₹{money(c.amount)}</span>
                  </div>
                ))}
              </div>
            </section>
          </div>

          {/* refunds */}
          {(data.refunds ?? []).length > 0 && (
            <section data-rise className="surface mt-6 overflow-hidden">
              <div className="border-b border-[var(--p-border)] px-5 py-3.5"><h2 className="text-[14px] font-semibold text-[var(--p-ink)]">Refunds given</h2></div>
              <div className="divide-y divide-[var(--p-border)]">
                {(data.refunds ?? []).map((r, i) => (
                  <div key={i} className="flex items-center justify-between gap-4 px-5 py-3">
                    <div>
                      <div className="text-[13px] text-[var(--p-ink)]">{r.patient} <span className="font-mono text-[12px] text-[var(--p-muted)]">· {r.receiptNo}</span></div>
                      <div className="text-[12px] text-[var(--p-muted)]">{r.reason} · by {r.by}</div>
                    </div>
                    <span className="font-mono text-[13px] font-semibold text-[var(--p-rose)]">−₹{money(r.amount)} <span className="text-[11px] font-normal text-[var(--p-muted)]">{r.mode}</span></span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* outstanding */}
          {(data.outstanding ?? []).length > 0 && (
            <section data-rise className="surface mt-6 overflow-hidden">
              <div className="border-b border-[var(--p-border)] px-5 py-3.5"><h2 className="text-[14px] font-semibold text-[var(--p-ink)]">Raised today, still due</h2></div>
              <div className="divide-y divide-[var(--p-border)]">
                {(data.outstanding ?? []).map((o) => (
                  <div key={o.receiptNo} className="flex items-center justify-between gap-4 px-5 py-3">
                    <div>
                      <div className="text-[13px] text-[var(--p-ink)]">{o.patient} <span className="font-mono text-[12px] text-[var(--p-muted)]">· {o.receiptNo}</span></div>
                      <div className="font-mono text-[12px] text-[var(--p-muted)]">₹{money(o.paid)} of ₹{money(o.total)} paid</div>
                    </div>
                    <span className="font-mono text-[14px] font-bold text-[#8a5a1a]">₹{money(o.due)} due</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* billed to insurers - reported, never counted. See the day close
              service: no money crossed a drawer, so this sits outside every
              collected/net figure on the page rather than inside one. */}
          {(data.insurance ?? []).length > 0 && (
            <section data-rise className="surface mt-6 overflow-hidden">
              <div className="border-b border-[var(--p-border)] px-5 py-3.5">
                <h2 className="text-[14px] font-semibold text-[var(--p-ink)]">Billed to insurers today</h2>
                <p className="mt-0.5 text-[12px] text-[var(--p-muted)]">Cashless - not collected, and not part of any total above.</p>
              </div>
              <div className="divide-y divide-[var(--p-border)]">
                {(data.insurance ?? []).map((o) => (
                  <div key={o.receiptNo} className="flex items-center justify-between gap-4 px-5 py-3">
                    <div>
                      <div className="text-[13px] text-[var(--p-ink)]">{o.patient} <span className="font-mono text-[12px] text-[var(--p-muted)]">· {o.receiptNo}</span></div>
                      <div className="text-[12px] text-[var(--p-muted)]">{o.insurer ?? "Insurer not recorded"}</div>
                    </div>
                    <span className="font-mono text-[14px] font-bold text-[var(--p-blue-deep)]">₹{money(o.total)}</span>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between border-t border-[var(--p-border)] bg-[var(--p-bg)] px-5 py-3">
                <span className="text-[12px] font-semibold uppercase tracking-wide text-[var(--p-muted)]">With insurers · not collected</span>
                <span className="font-mono text-[15px] font-bold text-[var(--p-blue-deep)]">₹{money(data.insuranceTotal ?? 0)}</span>
              </div>
            </section>
          )}
        </>
      )}
    </PortalScroll>
  );
}

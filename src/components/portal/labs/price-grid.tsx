"use client";

/**
 * EVERY LAB TEST AND WHAT IT COSTS, ON ONE SCREEN, EDITABLE IN PLACE.
 *
 * The catalogue was seeded from the lab's own 52 report forms, and a report form
 * carries no rate - so every test the seed could not carry a price over for was
 * created at ₹0. That is the failure this screen exists for, and it is a quiet
 * one: a test at ₹0 orders normally, bills normally and prints normally, and the
 * only sign anything is wrong is a patient who paid nothing for a CUE.
 *
 * WHY A GRID AND NOT THE CATALOGUE SCREEN'S MODAL. The catalogue screen already
 * edits a price - one test at a time, in a dialog that also loads that test's
 * normal values, closes, and re-reads the whole catalogue. That is the right
 * shape for correcting one rate. It is the wrong shape for forty: it is four
 * clicks and a round trip per row, and the fortieth never gets done. Here the
 * whole list is one tab-able column of inputs and one Save.
 *
 * WHAT IT DELIBERATELY DOES NOT EDIT: names, codes, active flags, GST, normal
 * values. All of those live on the catalogue screen. A screen that edits one
 * column can show every test at once without becoming a spreadsheet nobody
 * trusts, and the narrow write means a price fix cannot revert a rename someone
 * made in another tab. See bulkUpdateCatalogPrices.
 *
 * ONE COMPONENT, TWO PORTALS - the same arrangement the catalogue itself has.
 * Labs and Admin both mount this against the same API and the same row.
 */

import { useEffect, useMemo, useState } from "react";
import { PrimaryButton } from "@/components/portal/ui/primitives";
import { Icon } from "@/components/portal/ui/icons";
import { Spinner } from "@/components/portal/ui/form-atoms";
import { PortalScroll } from "@/components/portal/portal-scroll";
import { api, ApiClientError } from "@/lib/api-client";
import { useDebounce } from "@/lib/use-debounce";
import { Pagination } from "@/components/portal/ui/pagination";
// The SAME comparison the server writes by. If the screen decided "changed" its
// own way, the Save button would offer a count the server then disagreed with -
// "3 prices" saved as 2, with no explanation of which one it dropped.
import { samePaise, parsePrice } from "@/lib/lab-price";

interface Item {
  id: string; name: string; code: string | null;
  price: string; gstRatePct: string; active: boolean;
}

/** "Retired" is a real state, not an error - a withdrawn test keeps its history. */
type Filter = "all" | "unpriced" | "retired";

/** What the database says, so an edit can be compared against it and undone. */
type Original = Map<string, string>;

const money = (s: string) => {
  const n = Number(s);
  return Number.isFinite(n) ? n.toFixed(2) : s;
};

export function LabPriceGrid({ note }: { note?: React.ReactNode }) {
  const [items, setItems] = useState<Item[]>([]);
  const [original, setOriginal] = useState<Original>(new Map());
  /** id -> what is in the input right now. Strings: that is what inputs give. */
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const debouncedQ = useDebounce(q, 300);
  const [filter, setFilter] = useState<Filter>("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  async function load() {
    setLoading(true);
    try {
      // all=1: a retired test still has a price, and a test brought back with a
      // stale one is the same bug wearing a different hat.
      const { catalog } = await api.get<{ catalog: Item[] }>("/labs/catalog?all=1");
      setItems(catalog);
      setOriginal(new Map(catalog.map((c) => [c.id, money(c.price)])));
      setDraft(Object.fromEntries(catalog.map((c) => [c.id, money(c.price)])));
      setError(null);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Couldn't load the catalog.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  const unpriced = useMemo(
    () => items.filter((i) => i.active && Number(original.get(i.id) ?? i.price) === 0).length,
    [items, original],
  );

  /** Rows the technician has actually changed - the only ones that get sent. */
  const dirty = useMemo(
    () => items.filter((i) => {
      if (parsePrice(draft[i.id] ?? "") === null) return false;
      return !samePaise(draft[i.id], original.get(i.id) ?? i.price);
    }),
    [items, draft, original],
  );

  /**
   * Rows whose box does not hold a price - empty, or something like "6.5.0"
   * that the input filter let through and Number() cannot read.
   *
   * Save skips these, which is the safe thing to do and the confusing thing to
   * do silently: on a screen built for correcting thirty rows at once, one that
   * quietly did not save is worse than one that refused to. They are named
   * under the table and outlined in the grid.
   */
  const unreadable = useMemo(
    () => items.filter((i) => parsePrice(draft[i.id] ?? "") === null),
    [items, draft],
  );

  const shown = useMemo(() => {
    const needle = debouncedQ.trim().toLowerCase();
    return items.filter((i) => {
      // The zero filter reads the SAVED price, not the draft: a row must not
      // vanish from under the cursor the moment a price is typed into it.
      if (filter === "unpriced" && !(i.active && Number(original.get(i.id) ?? i.price) === 0)) return false;
      if (filter === "retired" && i.active) return false;
      if (!needle) return true;
      return i.name.toLowerCase().includes(needle) || (i.code ?? "").toLowerCase().includes(needle);
    });
  }, [items, original, debouncedQ, filter]);

  useEffect(() => {
    setPage(1);
  }, [debouncedQ, filter, pageSize]);

  const totalPages = Math.ceil(shown.length / pageSize) || 1;
  const pagedShown = useMemo(() => {
    return shown.slice((page - 1) * pageSize, page * pageSize);
  }, [shown, page, pageSize]);

  async function save() {
    if (!dirty.length) return;
    setBusy(true); setError(null); setSaved(null);
    try {
      const { updated } = await api.put<{ updated: number }>("/labs/catalog/prices", {
        prices: dirty.map((i) => ({ id: i.id, price: Number(draft[i.id]) })),
      });
      setSaved(
        updated === 0
          ? "Nothing had changed."
          : `${updated} price${updated === 1 ? "" : "s"} saved.`,
      );
      await load();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not save the prices.");
    } finally {
      setBusy(false);
    }
  }

  /** Put every input back to what the database says, dropping all edits. */
  const revert = () => {
    setDraft(Object.fromEntries(items.map((i) => [i.id, original.get(i.id) ?? money(i.price)])));
    setSaved(null); setError(null);
  };

  const fld = "w-full rounded-lg border border-[var(--p-border)] bg-white px-3 py-2 text-sm text-[var(--p-ink)] outline-none focus:border-[var(--p-teal)]";
  const chip = (f: Filter, label: string, n?: number) => (
    <button
      key={f}
      onClick={() => setFilter(f)}
      className={`rounded-lg border px-3 py-1.5 text-[12px] font-medium transition-colors ${
        filter === f
          ? "border-[var(--p-teal)] bg-[var(--p-teal)] text-white"
          : "border-[var(--p-border)] text-[var(--p-text)] hover:border-[var(--p-teal)]"
      }`}
    >
      {label}{n != null && n > 0 ? ` (${n})` : ""}
    </button>
  );

  return (
    <PortalScroll>
      <div data-rise className="surface dotgrid mb-6 flex flex-wrap items-center justify-between gap-4 px-6 py-5">
        <div>
          <h1 className="font-serif-p text-[22px] font-semibold text-[var(--p-ink)]">Test prices</h1>
          <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-[var(--p-muted)]">
            Every test in the catalogue and what it costs, editable here in one go. Type down the column and
            press Save once. {note}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {dirty.length > 0 && (
            <button
              onClick={revert}
              disabled={busy}
              className="rounded-lg border border-[var(--p-border)] px-4 py-2 text-sm text-[var(--p-text)] hover:border-[var(--p-rose)] hover:text-[var(--p-rose)] disabled:opacity-50"
            >
              Undo changes
            </button>
          )}
          <PrimaryButton onClick={save} disabled={busy || loading || dirty.length === 0}>
            {busy
              ? <><Spinner /> Saving…</>
              : <><Icon name="check" size={15} /> Save {dirty.length > 0 ? `${dirty.length} price${dirty.length === 1 ? "" : "s"}` : "prices"}</>}
          </PrimaryButton>
        </div>
      </div>

      {error && (
        <div data-rise className="mb-4 rounded-lg border border-[var(--p-rose)]/25 bg-[var(--p-rose-soft)] px-4 py-3 text-[13px] text-[var(--p-rose)]">
          {error}
        </div>
      )}
      {saved && (
        <div data-rise className="mb-4 rounded-lg border border-[var(--p-teal)]/25 bg-[var(--p-teal-soft)] px-4 py-3 text-[13px] text-[var(--p-teal)]">
          {saved}
        </div>
      )}

      {/* The zeros, named before anybody has to go looking for them. */}
      {!loading && unpriced > 0 && (
        <div data-rise className="mb-4 border-l-2 border-[#d8b878] bg-[var(--p-amber-soft)] px-4 py-3 text-[13px] leading-relaxed text-[#8a6414]">
          <strong>{unpriced} orderable test{unpriced === 1 ? "" : "s"} still {unpriced === 1 ? "costs" : "cost"} ₹0.</strong>{" "}
          The catalogue was built from the lab&apos;s report forms, which carry no rates - anything the import
          could not carry a price over for was left at zero, and it bills the patient nothing.
          {" "}
          <button onClick={() => setFilter("unpriced")} className="font-semibold underline underline-offset-2">
            Show only those
          </button>
        </div>
      )}

      <div data-rise className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name or code…"
            className={fld}
          />
        </div>
        {chip("all", "All", items.length)}
        {chip("unpriced", "₹0", unpriced)}
        {chip("retired", "Retired", items.filter((i) => !i.active).length)}
      </div>

      <section data-rise className="surface overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-[13px] text-[var(--p-muted)]"><Spinner /> Loading…</div>
        ) : shown.length === 0 ? (
          <div className="py-16 text-center text-[13px] text-[var(--p-muted)]">
            {items.length === 0 ? "The catalog is empty." : "Nothing matches that."}
          </div>
        ) : (
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="border-b border-[var(--p-border)] bg-[var(--p-bg)] text-[11px] uppercase tracking-wide text-[var(--p-muted)]">
                <th className="px-6 py-2.5 font-semibold">Test</th>
                <th className="py-2.5 font-semibold">Code</th>
                <th className="py-2.5 text-center font-semibold">GST</th>
                <th className="py-2.5 text-right font-semibold">Was</th>
                <th className="py-2.5 pr-6 text-right font-semibold">Price (₹)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--p-border)]">
              {pagedShown.map((i) => {
                const was = original.get(i.id) ?? money(i.price);
                const now = draft[i.id] ?? "";
                const parsed = parsePrice(now);
                const bad = parsed === null;
                const changed = !bad && !samePaise(now, was);
                // Zero is read off the INPUT here, not the saved value: a row
                // typed back down to 0 should look as wrong as one that arrived
                // that way.
                const zero = i.active && parsed === 0;
                return (
                  <tr key={i.id} className={i.active ? "" : "opacity-55"}>
                    <td className="px-6 py-2 font-medium text-[var(--p-ink)]">
                      {i.name}
                      {!i.active && <span className="ml-2 text-[11px] font-normal text-[var(--p-muted)]">retired</span>}
                    </td>
                    <td className="py-2 font-mono text-[12px] text-[var(--p-muted)]">{i.code ?? "-"}</td>
                    <td className="py-2 text-center">
                      {Number(i.gstRatePct) === 0
                        ? <span className="badge !text-[10px] text-[var(--p-teal)]">Exempt</span>
                        : <span className="font-mono text-[12px] font-semibold text-[var(--p-ink)]">{i.gstRatePct}%</span>}
                    </td>
                    {/* The old price stays on screen while the new one is typed,
                        so a mistyped rate is visible next to what it replaced
                        rather than only after a save. */}
                    <td className={`py-2 text-right font-mono text-[12px] ${changed ? "text-[var(--p-muted)] line-through" : "text-transparent"}`}>
                      ₹{was}
                    </td>
                    <td className="py-2 pr-6 text-right">
                      <input
                        value={now}
                        onChange={(e) => setDraft((d) => ({ ...d, [i.id]: e.target.value.replace(/[^\d.]/g, "") }))}
                        inputMode="decimal"
                        aria-label={`Price for ${i.name}`}
                        className={`ml-auto w-28 rounded-lg border bg-white px-3 py-1.5 text-right font-mono text-[13px] outline-none transition-colors ${
                          bad
                            ? "border-[var(--p-rose)] text-[var(--p-ink)]"
                            : changed
                              ? "border-[var(--p-teal)] bg-[var(--p-teal-soft)] font-semibold text-[var(--p-ink)]"
                              : zero
                                ? "border-[#d8b878] bg-[var(--p-amber-soft)] font-semibold text-[#8a6414]"
                                : "border-[var(--p-border)] text-[var(--p-ink)] focus:border-[var(--p-teal)]"
                        }`}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {!loading && shown.length > 0 && (
          <Pagination
            page={page}
            totalPages={totalPages}
            totalItems={shown.length}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
            itemLabel="tests"
          />
        )}
      </section>

      {unreadable.length > 0 && (
        <p data-rise className="mt-3 text-[12px] leading-relaxed text-[var(--p-rose)]">
          {unreadable.length} row{unreadable.length === 1 ? "" : "s"} outlined in red {unreadable.length === 1 ? "does" : "do"} not
          hold a price - blank, or something like &quot;6.5.0&quot;. Blank is not ₹0: Save skips {unreadable.length === 1 ? "it" : "them"} and
          {" "}{unreadable.length === 1 ? "it keeps" : "they keep"} whatever {unreadable.length === 1 ? "it" : "they"} had.
          {" "}
          {unreadable.slice(0, 4).map((i) => i.name).join(", ")}{unreadable.length > 4 ? ` and ${unreadable.length - 4} more` : ""}.
        </p>
      )}

      {!loading && (
        <p data-rise className="mt-3 text-[12px] leading-relaxed text-[var(--p-muted)]">
          A new price applies to tests ordered <strong>from now on</strong>. Samples already in the queue were
          billed at the rate that was set when they were raised, on purpose - a bill already given to a patient
          must not change under them. Correct those on the bill itself.
        </p>
      )}
    </PortalScroll>
  );
}

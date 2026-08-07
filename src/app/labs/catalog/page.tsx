"use client";

/**
 * THE LAB'S OWN VIEW OF THE TEST CATALOGUE.
 *
 * The same rows Admin -> Lab catalog & GST edits, through a door the bench can
 * reach. There is no syncing between the two screens and nothing to keep in
 * step: both write the one LabTestCatalog row through the one service function,
 * so a price corrected here IS the price admin sees, immediately, and the
 * correction lands in the same audit log either way.
 *
 * WHAT THIS SCREEN DELIBERATELY CANNOT DO IS SET GST. A tax rate is a CA's
 * call - most diagnostics are exempt under Notification 12/2017, and which of
 * the rest are taxable is not a question a bench answers between samples. The
 * rate is shown, because a technician quoting a price should know whether tax
 * rides on it, and it is read-only. The API leaves the field off its schema
 * entirely, so this is a rule and not just a missing input.
 *
 * The other thing it does that admin's screen does not is COUNT THE ZEROS. A
 * test at ₹0 bills a patient nothing and looks exactly like a real price on
 * every screen that isn't this one; the catalogue was seeded from report forms,
 * which carry no rates, so there were forty of them the day this page shipped.
 * They are what this page is mostly for.
 *
 * IT ALSO EDITS THE NORMAL VALUES. The rows a test reports, their units and the
 * ranges a result is flagged against, added and deleted here. That is safe to
 * hand to the bench because a reported result carries its OWN copy of the range
 * it was measured against - changing the template changes what the next sample
 * is judged by, and never what a report already printed says.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { PrimaryButton } from "@/components/portal/ui/primitives";
import { Icon } from "@/components/portal/ui/icons";
import { Spinner, Field } from "@/components/portal/ui/form-atoms";
import { PortalScroll } from "@/components/portal/portal-scroll";
import { api, ApiClientError } from "@/lib/api-client";
import { suggestTestCode } from "@/lib/lab-code";

interface Item {
  id: string; name: string; code: string | null;
  price: string; gstRatePct: string; active: boolean;
}

/** One normal-value row, held as strings because that is what the inputs give. */
interface Row {
  name: string; unit: string;
  refLow: string; refHigh: string; refText: string;
}
const emptyRow: Row = { name: "", unit: "", refLow: "", refHigh: "", refText: "" };

const blank = { id: "", name: "", code: "", price: "", active: true };
type Draft = typeof blank;

/** "Inactive" is a real state, not an error - a retired test keeps its history. */
type Filter = "all" | "unpriced" | "inactive";

export default function LabCatalogPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [edit, setEdit] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  /** The open test's normal values; null until they arrive, [] when it has none. */
  const [rows, setRows] = useState<Row[] | null>(null);
  const [rowsBusy, setRowsBusy] = useState(false);
  /** True once the technician types in the code box - stops the suggester. */
  const [codeTouched, setCodeTouched] = useState(false);

  async function load() {
    setLoading(true);
    try {
      // all=1: a retired test has to be visible to be brought back.
      const { catalog } = await api.get<{ catalog: Item[] }>("/labs/catalog?all=1");
      setItems(catalog);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Couldn't load the catalog.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  const unpriced = useMemo(() => items.filter((i) => i.active && Number(i.price) === 0).length, [items]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return items.filter((i) => {
      if (filter === "unpriced" && !(i.active && Number(i.price) === 0)) return false;
      if (filter === "inactive" && i.active) return false;
      if (!needle) return true;
      return i.name.toLowerCase().includes(needle) || (i.code ?? "").toLowerCase().includes(needle);
    });
  }, [items, q, filter]);

  /** Open the modal on a test - existing or new - and fetch its normal values. */
  const open = useCallback(async (item: Item | null) => {
    setSaved(null); setError(null); setCodeTouched(false);
    if (!item) { setEdit({ ...blank }); setRows([]); return; }
    setEdit({ id: item.id, name: item.name, code: item.code ?? "", price: item.price, active: item.active });
    setRows(null);
    setRowsBusy(true);
    try {
      const { analytes } = await api.get<{ analytes: {
        name: string; unit: string | null; refLow: string | null; refHigh: string | null; refText: string | null;
      }[] }>(`/labs/catalog/${item.id}/analytes`);
      setRows(analytes.map((a) => ({
        name: a.name,
        unit: a.unit ?? "",
        // Trailing zeros off the Decimal column: "1.5000" is 1.5 to a person.
        refLow: a.refLow == null ? "" : String(Number(a.refLow)),
        refHigh: a.refHigh == null ? "" : String(Number(a.refHigh)),
        refText: a.refText ?? "",
      })));
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Couldn't load this test's normal values.");
      setRows([]);
    } finally {
      setRowsBusy(false);
    }
  }, []);

  async function save() {
    if (!edit) return;
    setBusy(true); setError(null); setSaved(null);
    try {
      // gstRatePct is not sent - see the file note. An edit leaves whatever the
      // admin set; a new test starts exempt.
      const res = await api.post<{ code?: string }>("/labs/catalog", {
        id: edit.id || undefined,
        name: edit.name,
        code: edit.code || undefined,
        price: Number(edit.price),
        active: edit.active,
      });

      // The normal values are a second write, and it needs the test's id - which
      // a NEW test does not have until the line above returns. So a new test's
      // rows are saved on the next open rather than guessed at here; an existing
      // one saves both together.
      const kept = rows ?? [];
      if (edit.id) {
        await api.put(`/labs/catalog/${edit.id}/analytes`, {
          analytes: kept
            .filter((r) => r.name.trim())
            .map((r) => ({
              name: r.name.trim(),
              unit: r.unit.trim() || null,
              refLow: r.refLow.trim() === "" ? null : Number(r.refLow),
              refHigh: r.refHigh.trim() === "" ? null : Number(r.refHigh),
              refText: r.refText.trim() || null,
            })),
        });
      }

      setSaved(
        edit.id
          ? `${edit.name} saved.`
          : `${edit.name} added${res?.code ? ` as ${res.code}` : ""}. Open it again to set its normal values.`,
      );
      setEdit(null); setRows(null);
      await load();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  const setRow = (i: number, patch: Partial<Row>) =>
    setRows((prev) => (prev ?? []).map((r, n) => (n === i ? { ...r, ...patch } : r)));

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
          <h1 className="font-serif-p text-[22px] font-semibold text-[var(--p-ink)]">Test catalog</h1>
          <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-[var(--p-muted)]">
            Every test the lab can run, and what it costs. This is the same list Admin sees under
            {" "}<strong>Lab catalog &amp; GST</strong> - one record, two screens, so a price fixed here is fixed
            everywhere. GST rates are set by Admin and shown here read-only.
          </p>
        </div>
        <PrimaryButton onClick={() => open(null)}>
          <Icon name="plus" size={15} /> Add test
        </PrimaryButton>
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
          <strong>{unpriced} orderable test{unpriced === 1 ? "" : "s"} still {unpriced === 1 ? "has" : "have"} no price.</strong>{" "}
          A test at ₹0 bills the patient nothing and looks like any other price on the ordering screen.
          {" "}
          <button onClick={() => setFilter("unpriced")} className="font-semibold underline underline-offset-2">
            Show them
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
        {chip("unpriced", "No price", unpriced)}
        {chip("inactive", "Retired", items.filter((i) => !i.active).length)}
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
                <th className="py-2.5 text-right font-semibold">Price</th>
                <th className="py-2.5 text-center font-semibold">GST</th>
                <th className="py-2.5 text-center font-semibold">Status</th>
                <th className="px-6 py-2.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--p-border)]">
              {shown.map((i) => {
                const zero = i.active && Number(i.price) === 0;
                return (
                  <tr key={i.id} className={i.active ? "" : "opacity-55"}>
                    <td className="px-6 py-3 font-medium text-[var(--p-ink)]">{i.name}</td>
                    <td className="py-3 font-mono text-[12px] text-[var(--p-muted)]">{i.code ?? "-"}</td>
                    <td className={`py-3 text-right font-mono ${zero ? "font-semibold text-[#8a6414]" : ""}`}>
                      ₹{i.price}
                    </td>
                    <td className="py-3 text-center">
                      {Number(i.gstRatePct) === 0
                        ? <span className="badge !text-[10px] text-[var(--p-teal)]">Exempt</span>
                        : <span className="font-mono text-[12px] font-semibold text-[var(--p-ink)]">{i.gstRatePct}%</span>}
                    </td>
                    <td className="py-3 text-center text-[12px] text-[var(--p-muted)]">{i.active ? "Active" : "Retired"}</td>
                    <td className="px-6 py-3 text-right">
                      <button
                        onClick={() => open(i)}
                        className="rounded-lg border border-[var(--p-border)] px-3 py-1.5 text-[12px] font-medium text-[var(--p-teal)] hover:border-[var(--p-teal)]"
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      {edit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="surface flex max-h-[92vh] w-full max-w-2xl flex-col bg-white">
            <div className="border-b border-[var(--p-border)] px-6 py-4">
              <h3 className="text-[14px] font-semibold text-[var(--p-ink)]">{edit.id ? "Edit test" : "Add test"}</h3>
            </div>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-6">
              <Field label="Test name">
                <input
                  className={fld}
                  value={edit.name}
                  onChange={(e) => {
                    const name = e.target.value;
                    // The code follows the name until the technician takes it
                    // over. Only on a NEW test: an existing code is what the
                    // seed upserts on and what the printed report looks its
                    // department up by, so it is never rewritten behind them.
                    setEdit((prev) => prev && ({
                      ...prev,
                      name,
                      code: !prev.id && !codeTouched ? suggestTestCode(name) : prev.code,
                    }));
                  }}
                  autoFocus
                />
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <Field label={edit.id || codeTouched ? "Code" : "Code (from the name)"}>
                  <input
                    className={fld}
                    value={edit.code}
                    onChange={(e) => { setCodeTouched(true); setEdit({ ...edit, code: e.target.value }); }}
                  />
                </Field>
                <Field label="Price (₹)">
                  <input
                    className={fld}
                    value={edit.price}
                    onChange={(e) => setEdit({ ...edit, price: e.target.value.replace(/[^\d.]/g, "") })}
                    inputMode="decimal"
                  />
                </Field>
              </div>
              <p className="rounded-lg bg-[var(--p-bg)] px-3 py-2 text-[11px] leading-relaxed text-[var(--p-muted)]">
                GST is set by Admin under <strong>Lab catalog &amp; GST</strong> and is not changed by saving here -
                a new test starts exempt, which is what a diagnostic service normally is.
              </p>
              <label className="flex items-center gap-2 text-[13px] text-[var(--p-text)]">
                <input
                  type="checkbox"
                  checked={edit.active}
                  onChange={(e) => setEdit({ ...edit, active: e.target.checked })}
                  className="h-4 w-4 accent-[var(--p-teal)]"
                />
                Active (can be ordered)
              </label>
              {edit.id && !edit.active && (
                <p className="text-[11px] leading-relaxed text-[var(--p-muted)]">
                  Retiring a test hides it from the ordering screens. Results already reported against it stay
                  readable, and it can be brought back from the <strong>Retired</strong> filter.
                </p>
              )}

              {/* ── NORMAL VALUES ──
                  The rows this test reports. Only offered on a saved test: the
                  write needs an id, and a new one has none until it is created. */}
              <div className="border-t border-[var(--p-border)] pt-4">
                <div className="mb-1 flex items-center justify-between gap-3">
                  <h4 className="text-[13px] font-semibold text-[var(--p-ink)]">Normal values</h4>
                  {edit.id && rows && (
                    <button
                      onClick={() => setRows([...(rows ?? []), { ...emptyRow }])}
                      className="rounded-lg border border-[var(--p-border)] px-3 py-1.5 text-[12px] font-medium text-[var(--p-teal)] hover:border-[var(--p-teal)]"
                    >
                      <Icon name="plus" size={13} /> Add row
                    </button>
                  )}
                </div>
                <p className="mb-3 text-[11px] leading-relaxed text-[var(--p-muted)]">
                  What this test reports, and what a result is judged against. Give a low <em>and</em> a high for a
                  number, or a text reference like &quot;Negative&quot; - not both. Results already reported keep the
                  range they were measured against.
                </p>

                {!edit.id ? (
                  <p className="rounded-lg bg-[var(--p-bg)] px-3 py-2 text-[12px] text-[var(--p-muted)]">
                    Save the test first, then re-open it to add its rows.
                  </p>
                ) : rowsBusy || rows === null ? (
                  <div className="flex items-center gap-2 py-4 text-[12px] text-[var(--p-muted)]"><Spinner /> Loading rows…</div>
                ) : rows.length === 0 ? (
                  <p className="rounded-lg bg-[var(--p-bg)] px-3 py-2 text-[12px] text-[var(--p-muted)]">
                    No rows yet - the results form for this test would be empty. Add one.
                  </p>
                ) : (
                  <div className="space-y-2">
                    <div className="grid grid-cols-[1fr_78px_64px_64px_1fr_28px] gap-2 text-[10px] uppercase tracking-wide text-[var(--p-muted)]">
                      <span>Name</span><span>Unit</span><span>Low</span><span>High</span><span>Or text</span><span />
                    </div>
                    {rows.map((r, i) => {
                      const numeric = r.refLow.trim() !== "" || r.refHigh.trim() !== "";
                      const half = (r.refLow.trim() === "") !== (r.refHigh.trim() === "");
                      const both = numeric && r.refText.trim() !== "";
                      const bad = half || both;
                      return (
                        <div key={i} className="grid grid-cols-[1fr_78px_64px_64px_1fr_28px] items-center gap-2">
                          <input className={`${fld} !px-2 !py-1.5 !text-[12px] ${bad ? "!border-[var(--p-rose)]" : ""}`}
                            value={r.name} onChange={(e) => setRow(i, { name: e.target.value })} placeholder="Analyte" />
                          <input className={`${fld} !px-2 !py-1.5 !text-[12px]`}
                            value={r.unit} onChange={(e) => setRow(i, { unit: e.target.value })} placeholder="mg/dl" />
                          <input className={`${fld} !px-2 !py-1.5 !text-[12px] font-mono`} inputMode="decimal"
                            value={r.refLow} onChange={(e) => setRow(i, { refLow: e.target.value.replace(/[^\d.-]/g, "") })} />
                          <input className={`${fld} !px-2 !py-1.5 !text-[12px] font-mono`} inputMode="decimal"
                            value={r.refHigh} onChange={(e) => setRow(i, { refHigh: e.target.value.replace(/[^\d.-]/g, "") })} />
                          <input className={`${fld} !px-2 !py-1.5 !text-[12px] ${both ? "!border-[var(--p-rose)]" : ""}`}
                            value={r.refText} onChange={(e) => setRow(i, { refText: e.target.value })}
                            placeholder="Negative" disabled={numeric} />
                          <button
                            onClick={() => setRows(rows.filter((_, n) => n !== i))}
                            title={`Delete ${r.name || "this row"}`}
                            className="flex h-7 w-7 items-center justify-center rounded-lg border border-[var(--p-border)] text-[var(--p-muted)] hover:border-[var(--p-rose)] hover:text-[var(--p-rose)]"
                          >
                            <Icon name="x" size={13} />
                          </button>
                        </div>
                      );
                    })}
                    {rows.some((r) => (r.refLow.trim() === "") !== (r.refHigh.trim() === "")) && (
                      <p className="text-[11px] text-[var(--p-rose)]">
                        A row with only one end of its range would flag every result on the other side of it. Give both,
                        or clear both and use a text reference.
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
            <div className="flex justify-end gap-3 border-t border-[var(--p-border)] p-5">
              <button onClick={() => { setEdit(null); setRows(null); }} className="rounded-lg border border-[var(--p-border)] px-4 py-2 text-sm text-[var(--p-text)]">
                Cancel
              </button>
              <PrimaryButton
                onClick={save}
                disabled={
                  busy || edit.name.trim().length < 2 || edit.price === "" ||
                  // A half-range or a row carrying both kinds of reference is
                  // rejected by the API anyway; catching it here means the
                  // technician sees which row, not a sentence about one.
                  (rows ?? []).some((r) => {
                    const numeric = r.refLow.trim() !== "" || r.refHigh.trim() !== "";
                    return (r.refLow.trim() === "") !== (r.refHigh.trim() === "")
                      || (numeric && r.refText.trim() !== "")
                      || (!r.name.trim() && (numeric || r.refText.trim() !== "" || r.unit.trim() !== ""));
                  })
                }
              >
                {busy ? <><Spinner /> Saving…</> : <><Icon name="check" size={15} /> Save</>}
              </PrimaryButton>
            </div>
          </div>
        </div>
      )}
    </PortalScroll>
  );
}

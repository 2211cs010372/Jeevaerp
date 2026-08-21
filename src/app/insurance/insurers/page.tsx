"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/portal/ui/icons";
import { Spinner } from "@/components/portal/ui/form-atoms";
import { PortalScroll } from "@/components/portal/portal-scroll";
import { api, ApiClientError } from "@/lib/api-client";
import { KIND_LABEL, type InsurerKind } from "@/lib/insurers";

/**
 * THE INSURER LIST, KEPT BY THE PEOPLE WHO TALK TO INSURERS.
 *
 * Every "Insurer / TPA" box in the building suggests from one list - reception's
 * admission form, the ward board, the claim form - and that list was compiled
 * into the app. A hospital signs up a new TPA and the desk had no way to put it
 * on the list, so it typed the name free-hand, a little differently each time,
 * and the analytics board grew three rows for one insurer.
 *
 * WHAT THIS SCREEN CANNOT DO, on purpose:
 *
 *   It cannot rename anything. An admission and a claim keep the insurer's NAME
 *   as a plain string, snapshotted when it was typed, and the analytics board
 *   groups on that string. A rename here would leave every stay booked before
 *   today under one name and every stay after it under another - one insurer
 *   shown twice, each owing half. Wrong name: switch it off, add the right one.
 *
 *   It cannot delete the built-in names. They live in the app's source, not in
 *   the database - switching one off writes the row that says so, which is a
 *   thing that survives; deleting would only mean it came back on the next load.
 */

interface Row {
  name: string;
  kind: InsurerKind;
  active: boolean;
  /** Ships with the app. Cannot be deleted or renamed, only switched off. */
  builtIn: boolean;
  id: string | null;
}

const KINDS: InsurerKind[] = ["COMPANY", "PUBLIC_SECTOR", "TPA", "SCHEME"];

export default function InsurersPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [showOff, setShowOff] = useState(false);

  const [name, setName] = useState("");
  const [kind, setKind] = useState<InsurerKind>("COMPANY");
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      setRows((await api.get<{ rows: Row[] }>("/insurance/insurers")).rows);
      setError(null);
    }
    catch (e) { setError(e instanceof ApiClientError ? e.message : "Couldn't load the list."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function add() {
    if (name.trim().length < 2) return;
    setAdding(true);
    try {
      const { row } = await api.post<{ row: Row }>("/insurance/insurers", { name: name.trim(), kind });
      setName(""); setError(null);
      setFlash(`${row.name} added. It is on every insurer box from now on - reception's admission form included.`);
      load();
    }
    catch (e) { setError(e instanceof ApiClientError ? e.message : "Couldn't add it."); }
    finally { setAdding(false); }
  }

  async function toggle(r: Row) {
    setBusy(r.name);
    try {
      await api.patch<{ row: Row }>("/insurance/insurers", { name: r.name, active: !r.active });
      setError(null);
      setFlash(r.active
        ? `${r.name} switched off. It stops being suggested - the stays already on it are untouched.`
        : `${r.name} switched back on.`);
      load();
    }
    catch (e) { setError(e instanceof ApiClientError ? e.message : "Couldn't change it."); }
    finally { setBusy(null); }
  }

  const shown = useMemo(() => rows.filter((r) => {
    if (!showOff && !r.active) return false;
    if (!q.trim()) return true;
    return r.name.toLowerCase().includes(q.trim().toLowerCase());
  }), [rows, q, showOff]);

  const grouped = useMemo(
    () => KINDS.map((k) => ({ k, items: shown.filter((r) => r.kind === k) })).filter((g) => g.items.length > 0),
    [shown],
  );

  const onCount = rows.filter((r) => r.active).length;
  const offCount = rows.length - onCount;
  const addedCount = rows.filter((r) => !r.builtIn).length;

  return (
    <PortalScroll>
      <div data-rise className="surface dotgrid mb-5 px-6 py-5">
        <h1 className="font-serif-p text-[22px] font-semibold text-[var(--p-ink)]">Insurers &amp; TPAs</h1>
        <p className="mt-1 max-w-2xl text-[14px] leading-relaxed text-[var(--p-muted)]">
          The names every <b className="text-[var(--p-ink)]">Insurer / TPA</b> box suggests - reception&apos;s
          admission form, the ward board and the claim form all read this one list. Add the ones this
          hospital deals with; switch off the ones it never sees, so the box stops offering them.
        </p>
        <p className="mt-2 max-w-2xl text-[12.5px] leading-relaxed text-[var(--p-muted)]">
          Every one of those boxes still accepts a name typed straight in. This list is what it{" "}
          <i>suggests</i>, never what it allows - an admission must never be held up because a list is stale.
        </p>
      </div>

      {/* ── ADD ONE ──
          At the top, not behind a button. The reason somebody opens this screen
          is almost always that they have a TPA's name in their hand. */}
      <section data-rise className="surface mb-4 px-6 py-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[240px] flex-1">
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--p-muted)]">
              Insurer / TPA name
            </label>
            <input value={name} maxLength={120} onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !adding) add(); }}
              placeholder="e.g. Sri Gokulam Health Services (TPA)"
              className="w-full rounded-md border border-[var(--p-border)] bg-white px-3 py-2 text-sm text-[var(--p-ink)] outline-none focus:border-[var(--p-blue)]" />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--p-muted)]">
              Kind
            </label>
            <select value={kind} onChange={(e) => setKind(e.target.value as InsurerKind)}
              className="rounded-md border border-[var(--p-border)] bg-white px-3 py-2 text-sm text-[var(--p-ink)] outline-none focus:border-[var(--p-blue)]">
              {KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
            </select>
          </div>
          <button onClick={add} disabled={adding || name.trim().length < 2}
            className="inline-flex items-center gap-2 rounded-lg bg-[var(--p-blue)] px-4 py-2.5 text-[13px] font-semibold text-white transition-colors hover:bg-[var(--p-blue-deep)] disabled:opacity-40">
            {adding ? <Spinner size={14} /> : <Icon name="plus" size={15} />} Add to the list
          </button>
        </div>
        <p className="mt-2 text-[11.5px] leading-relaxed text-[var(--p-muted)]">
          Kind only groups this screen - every box reads one flat list of names.
          Write it the way it should appear on a claim, because that is the string that gets stored.
        </p>
      </section>

      {flash && (
        <div className="mb-4 flex items-start justify-between gap-3 rounded-lg border border-[var(--p-cyan)]/30 bg-[var(--p-cyan-soft)] px-4 py-3 text-[13.5px] font-medium text-[var(--p-cyan-deep)]">
          <span className="flex items-start gap-2"><Icon name="check" size={15} /> {flash}</span>
          <button onClick={() => setFlash(null)}>✕</button>
        </div>
      )}
      {error && <div className="mb-4 rounded-lg border border-[var(--p-rose)]/25 bg-[var(--p-rose-soft)] px-4 py-3 text-[14px] text-[var(--p-rose)]">{error}</div>}

      <div data-rise className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 rounded-md border border-[var(--p-border)] bg-white px-3 py-2">
          <Icon name="search" size={15} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a name…"
            className="w-60 bg-transparent text-sm outline-none" />
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[12.5px] text-[var(--p-muted)]">
            {onCount} suggested{addedCount > 0 && <> · {addedCount} added here</>}{offCount > 0 && <> · {offCount} off</>}
          </span>
          <button onClick={() => setShowOff((v) => !v)}
            className={`rounded-lg border px-3 py-1.5 text-[12px] font-semibold transition-colors ${
              showOff
                ? "border-[var(--p-blue)] bg-[var(--p-blue-soft)] text-[var(--p-blue-deep)]"
                : "border-[var(--p-border)] text-[var(--p-muted)] hover:text-[var(--p-ink)]"}`}>
            {showOff ? "Hiding nothing" : "Show the ones that are off"}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="surface flex items-center justify-center gap-2 py-20 text-[14px] text-[var(--p-muted)]"><Spinner /> Loading…</div>
      ) : shown.length === 0 ? (
        <div className="surface px-6 py-16 text-center text-[14px] text-[var(--p-muted)]">Nothing matches that.</div>
      ) : grouped.map((g) => (
        <section key={g.k} data-rise className="surface mb-4 overflow-hidden">
          <div className="flex items-center justify-between border-b border-[var(--p-border)] px-5 py-3">
            <h2 className="text-[13.5px] font-semibold text-[var(--p-ink)]">{KIND_LABEL[g.k]}</h2>
            <span className="text-[12px] text-[var(--p-muted)]">{g.items.length}</span>
          </div>
          <div className="divide-y divide-[var(--p-border)]">
            {g.items.map((r) => (
              <div key={r.name} className="flex flex-wrap items-center justify-between gap-3 px-5 py-2.5">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className={`text-[13.5px] ${r.active ? "font-medium text-[var(--p-ink)]" : "text-[var(--p-muted)] line-through"}`}>
                    {r.name}
                  </span>
                  {/* Said out loud, because it is the difference between "you may
                      switch this off" and "you may switch this off and it will
                      still be here after a deploy". */}
                  {r.builtIn && (
                    <span className="rounded-full bg-[var(--p-border)]/50 px-2 py-0.5 text-[10.5px] font-semibold uppercase text-[var(--p-muted)]">
                      Built in
                    </span>
                  )}
                  {!r.active && (
                    <span className="rounded-full bg-[var(--p-amber-soft)] px-2 py-0.5 text-[10.5px] font-semibold uppercase text-[#8a5a14]">
                      Not suggested
                    </span>
                  )}
                </div>
                <button onClick={() => toggle(r)} disabled={busy === r.name}
                  title={r.active
                    ? "Stop suggesting this name. Stays and claims already on it are untouched."
                    : "Suggest this name again"}
                  className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12px] font-semibold transition-colors disabled:opacity-40 ${
                    r.active
                      ? "border-[var(--p-border)] text-[var(--p-muted)] hover:border-[var(--p-rose)] hover:text-[var(--p-rose)]"
                      : "border-[var(--p-border)] text-[var(--p-blue)] hover:border-[var(--p-blue)]"}`}>
                  {busy === r.name ? <Spinner size={12} /> : <Icon name={r.active ? "x" : "check"} size={13} />}
                  {r.active ? "Switch off" : "Switch on"}
                </button>
              </div>
            ))}
          </div>
        </section>
      ))}
    </PortalScroll>
  );
}

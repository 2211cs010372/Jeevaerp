"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PrimaryButton } from "@/components/portal/ui/primitives";
import { Icon } from "@/components/portal/ui/icons";
import { Spinner, Field } from "@/components/portal/ui/form-atoms";
import { PortalScroll } from "@/components/portal/portal-scroll";
import {
  EmptyState, ErrorNote, Flash, GhostButton, Modal, PROC_CSS, PageHead, Tag, fld,
} from "@/components/portal/pharmacy/procurement-ui";
import { api, ApiClientError } from "@/lib/api-client";
import { MASTER_KINDS, MASTER_META, type MasterKind } from "@/lib/pharmacy/masters";

/**
 * THE PHARMACY'S VOCABULARIES, ON ONE SCREEN.
 *
 * Eight masters behind one set of tabs rather than eight pages in the nav. They
 * are all the same act - "add a word this pharmacy uses" - and a pharmacist
 * setting up the catalogue does five of them in one sitting. Eight separate
 * screens would make that five round trips through a menu.
 *
 * The form is per-kind because the masters genuinely differ: a tax rate needs a
 * percentage, an HSN needs the rate it attracts, a schedule needs its retention
 * period. Only the fields that master actually has are rendered.
 */

interface MasterRow {
  id: string;
  label: string;
  detail: string | null;
  active: boolean;
  usedBy: number;
  extra: Record<string, string | number | boolean | null>;
}

type Draft = {
  id: string; label: string; active: boolean;
  description: string; strength: string; shortCode: string; address: string; phone: string;
  symbol: string; ratePct: string; defaultTaxRateId: string;
  requiresPrescription: boolean; retentionYears: string;
};

const blank: Draft = {
  id: "", label: "", active: true,
  description: "", strength: "", shortCode: "", address: "", phone: "",
  symbol: "", ratePct: "", defaultTaxRateId: "",
  requiresPrescription: true, retentionYears: "",
};

const str = (v: unknown) => (v == null ? "" : String(v));

export default function PharmacyMastersPage() {
  const [kind, setKind] = useState<MasterKind>("category");
  const [rows, setRows] = useState<MasterRow[]>([]);
  const [taxRates, setTaxRates] = useState<MasterRow[]>([]);
  const [q, setQ] = useState("");
  const [showRetired, setShowRetired] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [edit, setEdit] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);

  const meta = MASTER_META[kind];

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      if (q) p.set("q", q);
      if (showRetired) p.set("all", "1");
      const r = await api.get<{ rows: MasterRow[] }>(`/pharmacy/masters/${kind}${p.toString() ? `?${p}` : ""}`);
      setRows(r.rows);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Couldn't load that master.");
    } finally { setLoading(false); }
  }, [kind, q, showRetired]);

  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t); }, [load]);

  // HSN rows offer a tax rate to default to, so that list is needed alongside.
  useEffect(() => {
    if (kind !== "hsn") return;
    api.get<{ rows: MasterRow[] }>("/pharmacy/masters/tax")
      .then((r) => setTaxRates(r.rows))
      .catch(() => setTaxRates([]));
  }, [kind]);

  function openNew() { setEdit({ ...blank }); }
  function openEdit(r: MasterRow) {
    setEdit({
      ...blank,
      id: r.id, label: r.label, active: r.active,
      description: str(r.extra.description),
      strength: str(r.extra.strength),
      shortCode: str(r.extra.shortCode),
      address: str(r.extra.address),
      phone: str(r.extra.phone),
      symbol: str(r.extra.symbol),
      ratePct: str(r.extra.ratePct),
      defaultTaxRateId: str(r.extra.defaultTaxRateId),
      requiresPrescription: r.extra.requiresPrescription !== false,
      retentionYears: str(r.extra.retentionYears),
    });
  }

  async function save() {
    if (!edit) return;
    setBusy(true); setError(null);
    try {
      // Only this master's own fields go up. Sending the whole draft would
      // push an empty `ratePct` at a category and fail validation on a field
      // the user was never shown.
      const body: Record<string, unknown> = {
        id: edit.id || undefined,
        label: edit.label,
        active: edit.active,
      };
      if (kind === "category" || kind === "hsn" || kind === "schedule") body.description = edit.description;
      if (kind === "generic") { body.strength = edit.strength; body.description = edit.description; }
      if (kind === "manufacturer") { body.shortCode = edit.shortCode; body.address = edit.address; body.phone = edit.phone; }
      if (kind === "unit") body.symbol = edit.symbol;
      if (kind === "tax") body.ratePct = Number(edit.ratePct || 0);
      if (kind === "hsn") body.defaultTaxRateId = edit.defaultTaxRateId;
      if (kind === "schedule") {
        body.requiresPrescription = edit.requiresPrescription;
        if (edit.retentionYears) body.retentionYears = Number(edit.retentionYears);
      }

      await api.post(`/pharmacy/masters/${kind}`, body);
      setFlash(`${edit.label} saved.`);
      setEdit(null);
      await load();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Couldn't save that.");
    } finally { setBusy(false); }
  }

  async function toggleActive(r: MasterRow) {
    setBusy(true); setError(null);
    try {
      await api.patch(`/pharmacy/masters/${kind}/${r.id}`, { active: !r.active });
      setFlash(r.active ? `${r.label} retired - it's out of the pickers, nothing else changed.` : `${r.label} is back in use.`);
      await load();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Couldn't change that.");
    } finally { setBusy(false); }
  }

  const inUse = useMemo(() => rows.filter((r) => r.usedBy > 0).length, [rows]);

  return (
    <PortalScroll>
      <style>{PROC_CSS}</style>

      <PageHead
        title="Master data"
        blurb="The vocabularies this pharmacy describes its medicines in. Set these up once; every medicine then picks from them."
      >
        <Link href="/stock"
          className="inline-flex items-center gap-2 rounded-lg border border-[var(--p-border)] px-4 py-2.5 text-sm font-medium text-[var(--p-blue)] hover:border-[var(--p-blue)]">
          <Icon name="bed" size={15} /> Stock &amp; batches
        </Link>
        <PrimaryButton onClick={openNew}>
          <Icon name="plus" size={15} /> New {meta.singular.toLowerCase()}
        </PrimaryButton>
      </PageHead>

      {flash && <Flash text={flash} onClose={() => setFlash(null)} />}
      {error && !edit && <ErrorNote text={error} />}

      {/* TABS - one per master. */}
      <div data-rise className="surface mb-4 flex flex-wrap gap-1 p-2">
        {MASTER_KINDS.map((k) => (
          <button key={k} onClick={() => { setKind(k); setQ(""); }}
            className={`rounded-lg px-3 py-1.5 text-[13px] font-semibold transition-colors ${
              kind === k ? "bg-[var(--p-blue)] text-white" : "text-[var(--p-muted)] hover:bg-[var(--p-bg)]"
            }`}>
            {MASTER_META[k].title}
          </button>
        ))}
      </div>

      <p data-rise className="mb-4 text-[13px] leading-relaxed text-[var(--p-muted)]">{meta.blurb}</p>

      {/* THE COMPLIANCE NOTE, ON THE SCREEN THAT COULD BREAK IT. */}
      {kind === "schedule" && (
        <div data-rise className="mb-4 rounded-lg border border-[var(--p-amber)]/40 bg-[var(--p-amber-soft)] px-4 py-3 text-[12.5px] leading-relaxed text-[#8a6414]">
          <b>Nothing here is filled in for you.</b> Whether a medicine is Schedule H, H1 or X is a
          regulatory fact about that specific product - this system will never guess it from a name.
          Enter the schedules your licence covers, then set them on each medicine yourself.
        </div>
      )}

      <div data-rise className="surface mb-4 flex flex-wrap items-center gap-3 px-4 py-3">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${meta.title.toLowerCase()}…`}
          className={`${fld} max-w-xs`} />
        <label className="flex items-center gap-2 text-[13px] text-[var(--p-text)]">
          <input type="checkbox" checked={showRetired} onChange={(e) => setShowRetired(e.target.checked)}
            className="h-4 w-4 accent-[var(--p-blue)]" />
          Show retired
        </label>
        <span className="ml-auto text-[12px] text-[var(--p-muted)]">
          {rows.length} {rows.length === 1 ? "row" : "rows"}
          {inUse > 0 && <> · {inUse} in use</>}
        </span>
      </div>

      <section data-rise className="surface overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-[14px] text-[var(--p-muted)]"><Spinner /> Loading…</div>
        ) : rows.length === 0 ? (
          <EmptyState icon="file" title={`No ${meta.title.toLowerCase()} yet`}
            hint={`Add the first one, and every medicine form will offer it from then on.`} />
        ) : (
          <div className="divide-y divide-[var(--p-border)]">
            {rows.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[14px] font-semibold text-[var(--p-ink)]">{r.label}</span>
                    {!r.active && <Tag tone="mute">Retired</Tag>}
                    {r.usedBy > 0 && <Tag tone="info">{r.usedBy} medicine{r.usedBy === 1 ? "" : "s"}</Tag>}
                  </div>
                  {r.detail && <div className="mt-0.5 text-[12.5px] text-[var(--p-muted)]">{r.detail}</div>}
                </div>
                <div className="flex items-center gap-2">
                  <GhostButton onClick={() => openEdit(r)} disabled={busy}>
                    <Icon name="settings" size={14} /> Edit
                  </GhostButton>
                  <GhostButton onClick={() => toggleActive(r)} disabled={busy} tone={r.active ? "danger" : undefined}>
                    <Icon name={r.active ? "x" : "undo"} size={14} /> {r.active ? "Retire" : "Restore"}
                  </GhostButton>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {edit && (
        <Modal
          title={edit.id ? `Edit ${meta.singular.toLowerCase()}` : `New ${meta.singular.toLowerCase()}`}
          onClose={() => { setEdit(null); setError(null); }}
          footer={
            <>
              <button onClick={() => { setEdit(null); setError(null); }}
                className="rounded-lg border border-[var(--p-border)] px-4 py-2 text-sm text-[var(--p-text)]">Cancel</button>
              <PrimaryButton onClick={save} disabled={busy || !edit.label.trim()}>
                {busy ? <><Spinner /> Saving…</> : <><Icon name="check" size={15} /> Save</>}
              </PrimaryButton>
            </>
          }
        >
          <div className="space-y-3 p-3">
            <Field label={meta.labelField === "code" ? "Code" : "Name"} required>
              <input className={fld} value={edit.label} autoFocus
                onChange={(e) => setEdit({ ...edit, label: e.target.value })} />
            </Field>

            {kind === "generic" && (
              <Field label="Strength">
                <input className={fld} value={edit.strength} placeholder="500mg"
                  onChange={(e) => setEdit({ ...edit, strength: e.target.value })} />
                <p className="mt-1 text-[12px] text-[var(--p-muted)]">
                  Free text - real cartons write strengths a dozen ways.
                </p>
              </Field>
            )}

            {kind === "manufacturer" && (
              <>
                <Field label="Short code">
                  <input className={fld} value={edit.shortCode} placeholder="CIPLA"
                    onChange={(e) => setEdit({ ...edit, shortCode: e.target.value })} />
                  <p className="mt-1 text-[12px] text-[var(--p-muted)]">
                    As printed in the OMrp column on distributor invoices.
                  </p>
                </Field>
                <Field label="Phone">
                  <input className={fld} value={edit.phone}
                    onChange={(e) => setEdit({ ...edit, phone: e.target.value })} />
                </Field>
                <Field label="Address">
                  <textarea className={`${fld} min-h-[56px] resize-y`} value={edit.address}
                    onChange={(e) => setEdit({ ...edit, address: e.target.value })} />
                </Field>
              </>
            )}

            {kind === "unit" && (
              <Field label="Symbol">
                <input className={fld} value={edit.symbol} placeholder="ml"
                  onChange={(e) => setEdit({ ...edit, symbol: e.target.value })} />
              </Field>
            )}

            {kind === "tax" && (
              <Field label="Rate %">
                <input className={fld} inputMode="decimal" value={edit.ratePct} placeholder="5"
                  onChange={(e) => setEdit({ ...edit, ratePct: e.target.value.replace(/[^\d.]/g, "") })} />
                <p className="mt-1 text-[12px] text-[var(--p-muted)]">
                  Changing this never reprices anything already sold - invoices keep the rate they were raised at.
                </p>
              </Field>
            )}

            {kind === "hsn" && (
              <Field label="Rate this classification attracts">
                <select className={fld} value={edit.defaultTaxRateId}
                  onChange={(e) => setEdit({ ...edit, defaultTaxRateId: e.target.value })}>
                  <option value="">— not set —</option>
                  {taxRates.map((t) => (
                    <option key={t.id} value={t.id}>{t.label} ({t.detail})</option>
                  ))}
                </select>
                <p className="mt-1 text-[12px] text-[var(--p-muted)]">
                  Seeds the rate on a new medicine. It never overrides one that is already set -
                  a disagreement is shown on the stock list for a human to settle.
                </p>
              </Field>
            )}

            {kind === "schedule" && (
              <>
                <label className="flex items-center gap-2 text-[14px] text-[var(--p-text)]">
                  <input type="checkbox" checked={edit.requiresPrescription} className="h-4 w-4 accent-[var(--p-blue)]"
                    onChange={(e) => setEdit({ ...edit, requiresPrescription: e.target.checked })} />
                  Dispensing requires a prescription on file
                </label>
                <Field label="Register retention (years)">
                  <input className={fld} inputMode="numeric" value={edit.retentionYears} placeholder="2"
                    onChange={(e) => setEdit({ ...edit, retentionYears: e.target.value.replace(/\D/g, "") })} />
                </Field>
              </>
            )}

            {(kind === "category" || kind === "generic" || kind === "hsn" || kind === "schedule") && (
              <Field label="Description">
                <textarea className={`${fld} min-h-[56px] resize-y`} value={edit.description}
                  onChange={(e) => setEdit({ ...edit, description: e.target.value })} />
              </Field>
            )}

            <label className="flex items-center gap-2 text-[14px] text-[var(--p-text)]">
              <input type="checkbox" checked={edit.active} className="h-4 w-4 accent-[var(--p-blue)]"
                onChange={(e) => setEdit({ ...edit, active: e.target.checked })} />
              In use
            </label>

            {error && <ErrorNote text={error} />}
          </div>
        </Modal>
      )}
    </PortalScroll>
  );
}

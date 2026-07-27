"use client";

import { useEffect } from "react";
import { Icon, type IconName } from "@/components/portal/ui/icons";

/**
 * Shared chrome for the five procurement screens.
 *
 * These pages are read in a specific order - decide, order, receive, claim -
 * so they have to look like one tool rather than five. Everything that would
 * otherwise be copy-pasted five times lives here.
 */

export const inr = (v: string | number | null | undefined, decimals = 0) => {
  const n = typeof v === "string" ? Number(v) : (v ?? 0);
  if (!Number.isFinite(n)) return "₹0";
  return "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
};

/** dd/mm/yy - the format on the delivery note in the pharmacist's hand. */
export const dmy = (iso: string | null | undefined) =>
  iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(2, 4)}` : "-";

export const dmyFromISO = (ts: string | null | undefined) => (ts ? dmy(ts.slice(0, 10)) : "-");

export function daysUntil(iso: string): number {
  const t = new Date(); t.setHours(0, 0, 0, 0);
  return Math.round((new Date(iso + "T00:00:00").getTime() - t.getTime()) / 86400000);
}

/** The field styling every form on these screens uses. */
export const fld =
  "w-full rounded-lg border border-[var(--p-border)] bg-white px-3 py-2 text-sm text-[var(--p-ink)] outline-none transition-colors focus:border-[var(--p-blue)]";

type Tone = "ok" | "warn" | "bad" | "info" | "mute";

const TONES: Record<Tone, string> = {
  ok: "bg-[var(--p-cyan-soft)] text-[var(--p-cyan-deep)] ring-[var(--p-cyan)]/20",
  warn: "bg-[var(--p-amber-soft)] text-[#8a6414] ring-[var(--p-amber)]/25",
  bad: "bg-[var(--p-rose-soft)] text-[var(--p-rose)] ring-[var(--p-rose)]/20",
  info: "bg-[var(--p-blue-soft)] text-[var(--p-blue-deep)] ring-[var(--p-blue)]/20",
  mute: "bg-[var(--p-bg)] text-[var(--p-muted)] ring-[var(--p-border)]",
};

export function Tag({ tone = "mute", children }: { tone?: Tone; children: React.ReactNode }) {
  return (
    <span className={`inline-flex whitespace-nowrap items-center gap-1 rounded-full px-2.5 py-1 text-[11.5px] font-semibold ring-1 ring-inset ${TONES[tone]}`}>
      {children}
    </span>
  );
}

/** Purchase-order status, in words a pharmacist uses rather than enum names. */
export function poStatus(status: string): { label: string; tone: Tone } {
  switch (status) {
    case "DRAFT": return { label: "Draft", tone: "mute" };
    case "SENT": return { label: "With supplier", tone: "info" };
    case "PARTIALLY_RECEIVED": return { label: "Part delivered", tone: "warn" };
    case "RECEIVED": return { label: "Complete", tone: "ok" };
    case "CANCELLED": return { label: "Cancelled", tone: "bad" };
    default: return { label: status, tone: "mute" };
  }
}

export function returnStatus(status: string): { label: string; tone: Tone } {
  switch (status) {
    case "DRAFT": return { label: "Not sent", tone: "mute" };
    case "SENT": return { label: "Awaiting credit", tone: "warn" };
    case "CREDITED": return { label: "Credited", tone: "ok" };
    case "REJECTED": return { label: "Refused", tone: "bad" };
    default: return { label: status, tone: "mute" };
  }
}

export function PageHead({
  title, blurb, children,
}: { title: string; blurb: string; children?: React.ReactNode }) {
  return (
    <div data-rise className="surface dotgrid mb-5 flex flex-wrap items-end justify-between gap-4 px-6 py-5">
      <div>
        <h1 className="font-serif-p text-[22px] font-semibold tracking-[-0.02em] text-[var(--p-ink)]">{title}</h1>
        <p className="mt-1 max-w-[620px] text-[13px] leading-relaxed text-[var(--p-muted)]">{blurb}</p>
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

/** A compact metric strip - the numbers you scan before doing anything. */
export function StatStrip({ items }: { items: { label: string; value: string; tone?: Tone; sub?: string }[] }) {
  return (
    <div data-rise className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {items.map((s) => (
        <div key={s.label} className="surface px-4 py-3.5">
          <div className="text-[10px] font-bold uppercase tracking-[0.09em] text-[var(--p-muted)]">{s.label}</div>
          <div className={`num mt-1.5 text-[21px] font-bold ${
            s.tone === "bad" ? "text-[var(--p-rose)]" : s.tone === "warn" ? "text-[var(--p-amber)]" : "text-[var(--p-ink)]"
          }`}>{s.value}</div>
          {s.sub && <div className="mt-0.5 text-[11px] text-[var(--p-muted)]">{s.sub}</div>}
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ icon, title, hint }: { icon: IconName; title: string; hint: string }) {
  return (
    <section data-rise className="surface grid place-items-center px-6 py-20 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-xl bg-[var(--p-cyan-soft)] text-[var(--p-cyan-deep)]">
        <Icon name={icon} size={22} />
      </span>
      <p className="mt-3 text-[14px] font-semibold text-[var(--p-ink)]">{title}</p>
      <p className="mt-1 max-w-sm text-[12px] leading-relaxed text-[var(--p-muted)]">{hint}</p>
    </section>
  );
}

export function Flash({ text, onClose }: { text: string; onClose: () => void }) {
  return (
    <div data-rise className="mb-4 flex items-center justify-between rounded-lg border border-[var(--p-cyan)]/30 bg-[var(--p-cyan-soft)] px-4 py-3 text-[13px] font-medium text-[var(--p-cyan-deep)]">
      <span className="flex items-center gap-2"><Icon name="check" size={15} /> {text}</span>
      <button onClick={onClose} aria-label="Dismiss"><Icon name="x" size={14} /></button>
    </div>
  );
}

export function ErrorNote({ text }: { text: string }) {
  return (
    <div data-rise className="mb-4 flex items-start gap-2 rounded-lg border border-[var(--p-rose)]/25 bg-[var(--p-rose-soft)] px-4 py-3 text-[13px] leading-relaxed text-[var(--p-rose)]">
      <span className="mt-0.5 shrink-0"><Icon name="alert" size={15} /></span>
      <span>{text}</span>
    </div>
  );
}

/** Modal shell. Escape closes it, but never while a save is in flight. */
export function Modal({
  title, sub, wide, busy, onClose, children, footer,
}: {
  title: string; sub?: string; wide?: boolean; busy?: boolean;
  onClose: () => void; children: React.ReactNode; footer: React.ReactNode;
}) {
  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [busy, onClose]);

  return (
    <div className="modal-veil" onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className={`surface flex max-h-[90vh] w-full flex-col bg-white ${wide ? "max-w-9xl" : "max-w-md"}`}>
        <div className="shrink-0 border-b border-[var(--p-border)] px-6 py-4">
          <h3 className="text-[14px] font-semibold text-[var(--p-ink)]">{title}</h3>
          {sub && <p className="mt-0.5 text-[12px] text-[var(--p-muted)]">{sub}</p>}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        <div className="flex shrink-0 flex-wrap justify-end gap-3 border-t border-[var(--p-border)] p-5">{footer}</div>
      </div>
    </div>
  );
}

export function GhostButton({
  children, onClick, disabled, tone,
}: { children: React.ReactNode; onClick?: () => void; disabled?: boolean; tone?: "danger" }) {
  return (
    <button
      onClick={onClick} disabled={disabled}
      className={`inline-flex items-center gap-1.5 rounded-lg border border-[var(--p-border)] px-3.5 py-2 text-[13px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
        tone === "danger"
          ? "text-[var(--p-rose)] hover:border-[var(--p-rose)] hover:bg-[var(--p-rose-soft)]"
          : "text-[var(--p-text)] hover:border-[var(--p-blue)] hover:text-[var(--p-blue)]"
      }`}
    >
      {children}
    </button>
  );
}

/**
 * Every procurement screen loads this. Kept in one string so the five pages
 * stay visually identical - `.num` in particular, because a column of rupee
 * figures that doesn't line up is a column nobody checks.
 */
export const PROC_CSS = `
.num { font-family: var(--font-mono); font-variant-numeric: tabular-nums; letter-spacing: -0.01em; }
.lbl { display:block; margin-bottom:3px; font-size:9px; font-weight:700; letter-spacing:.09em;
  text-transform:uppercase; color:var(--p-muted); }

.doc { font-family:var(--font-mono); font-size:12.5px; font-weight:700; letter-spacing:.02em;
  color:var(--p-ink); }

.prow { animation: prowIn .3s cubic-bezier(.22,.68,.28,1) both; animation-delay: var(--d, 0ms);
  transition: background-color .15s ease; }
.prow:hover { background: var(--p-bg); }
@keyframes prowIn { from { opacity:0; transform: translateY(4px); } to { opacity:1; transform:none; } }
@media (prefers-reduced-motion: reduce) { .prow { animation:none; } }

.seg { display:inline-flex; align-items:center; gap:7px; border-radius:9px; border:1px solid var(--p-border);
  background:#fff; padding:7px 12px; font-size:13px; font-weight:600; color:var(--p-text);
  transition: border-color .15s ease, background-color .15s ease, color .15s ease, transform .12s ease; }
.seg:hover { border-color:var(--p-blue); transform: translateY(-1px); }
.seg-n { border-radius:5px; background:var(--p-bg); padding:1px 6px; font-size:11px; font-weight:700; color:var(--p-muted);
  font-family:var(--font-mono); }
.seg-on { border-color:var(--p-blue); background:var(--p-blue); color:#fff; box-shadow:0 4px 14px var(--p-blue-glow); }
.seg-on .seg-n { background:rgba(255,255,255,.22); color:#fff; }
.seg-warn .seg-n { background:var(--p-amber-soft); color:#8a6414; }
.seg-bad  .seg-n { background:var(--p-rose-soft);  color:var(--p-rose); }

.modal-veil { position:fixed; inset:0; z-index:50; display:flex; align-items:center; justify-content:center;
  padding:16px; background:rgba(9,26,52,.42); backdrop-filter:blur(3px); animation: veilIn .16s ease both; }
@keyframes veilIn { from { opacity:0 } to { opacity:1 } }
.modal-veil > * { animation: sheetIn .22s cubic-bezier(.22,.68,.28,1) both; }
@keyframes sheetIn { from { opacity:0; transform: translateY(10px) scale(.985) } to { opacity:1; transform:none } }
@media (prefers-reduced-motion: reduce) { .modal-veil, .modal-veil > * { animation:none } }

/* progress of a delivery against what was ordered */
.fill { height:5px; width:100%; max-width:150px; border-radius:999px; background:var(--p-border); overflow:hidden; }
.fill > i { display:block; height:100%; border-radius:999px; transition:width .45s cubic-bezier(.22,.68,.28,1); }

/* the "money you're owed / money that doesn't add up" strip */
.warnstrip { display:flex; width:100%; align-items:center; gap:8px; padding:8px 20px; text-align:left;
  border-top:1px solid rgba(224,67,92,.2); background:var(--p-rose-soft); font-size:12px; color:var(--p-rose); }
.warnstrip-amber { border-top-color:rgba(196,148,20,.28); background:var(--p-amber-soft); color:#8a6414; }

.ptable { width:100%; border-collapse:collapse; }
.ptable th { padding:8px 10px; text-align:left; font-size:9.5px; font-weight:700; letter-spacing:.09em;
  text-transform:uppercase; color:var(--p-muted); border-bottom:1px solid var(--p-border); white-space:nowrap; }
.ptable td { padding:9px 10px; font-size:13px; color:var(--p-ink); border-bottom:1px solid var(--p-border); vertical-align:middle; }
/* A unit qualifier under a column head - "Qty (packs)" vs "Units (on shelf)".
   The distinction is the whole point of the column, so it is spelled out
   rather than left to be inferred from the heading. */
.th-sub { display:block; margin-top:1px; font-size:8px; font-weight:600; letter-spacing:.04em;
  text-transform:none; color:var(--p-muted); }
.ptable tbody tr:last-child td { border-bottom:0; }
.ptable .r { text-align:right; }

.kbd { border-radius:5px; border:1px solid var(--p-border); background:var(--p-bg); padding:1px 6px;
  font-family:var(--font-mono); font-size:11px; color:var(--p-muted); }
`;

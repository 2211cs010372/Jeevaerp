"use client";

// ---------------------------------------------------------------------------
// The measured values on a finished investigation.
//
// A lab report PDF is a picture of a result: it can't be flagged, scanned in a
// list, or read on a phone at arm's length. These are the numbers themselves,
// each shown next to the range it was judged against, so the out-of-range line
// is the one that catches the eye.
//
// Deliberately shared by the doctor's chart, the lab counter and the patient's
// own portal. All three are reading the SAME sheet, and a result that renders
// differently depending on who is looking at it is a result nobody can trust.
// ---------------------------------------------------------------------------

export type LabResultFlag = "NORMAL" | "HIGH" | "LOW" | "ABNORMAL";

export interface LabResultRow {
  name: string;
  unit: string | null;
  value: string;
  refLow: string | null;
  refHigh: string | null;
  refText: string | null;
  flag: LabResultFlag;
  sortOrder: number;
}

/** Colour and marker per flag. NORMAL stays quiet on purpose - only the
 *  abnormal lines should draw the eye. */
const FLAG_STYLE: Record<LabResultFlag, { tint: string; ink: string; mark: string; label: string }> = {
  NORMAL: { tint: "transparent", ink: "var(--p-ink)", mark: "", label: "" },
  HIGH: { tint: "var(--p-rose-soft)", ink: "var(--p-rose)", mark: "▲", label: "High" },
  LOW: { tint: "var(--p-blue-soft)", ink: "var(--p-blue)", mark: "▼", label: "Low" },
  ABNORMAL: { tint: "var(--p-amber-soft)", ink: "var(--p-amber)", mark: "!", label: "Abnormal" },
};

/** "13.0 - 17.0", or the text range for results that aren't numbers. */
export function formatRange(r: Pick<LabResultRow, "refLow" | "refHigh" | "refText">): string {
  if (r.refLow !== null && r.refHigh !== null) return `${r.refLow} - ${r.refHigh}`;
  if (r.refLow !== null) return `> ${r.refLow}`;
  if (r.refHigh !== null) return `< ${r.refHigh}`;
  return r.refText ?? "-";
}

/**
 * A small count of out-of-range lines. Renders nothing at all when everything
 * is normal in `compact` mode - an empty row is a better signal than a green
 * tick on every single test in a list of thirty.
 */
export function AbnormalPill({ count, compact = false }: { count: number; compact?: boolean }) {
  if (count === 0) {
    if (compact) return null;
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-[var(--p-cyan-soft)] px-2 py-0.5 text-[10.5px] font-semibold text-[var(--p-cyan-deep)]">
        All normal
      </span>
    );
  }
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-[var(--p-rose-soft)] px-2 py-0.5 text-[10.5px] font-semibold text-[var(--p-rose)]">
      {count} out of range
    </span>
  );
}

/**
 * The sheet itself.
 *
 * Laid out as a grid rather than a <table> so it can reflow to two lines on a
 * phone without a horizontal scrollbar - patients read these on the smallest
 * screen we support, and a report you have to pan sideways is a report that
 * doesn't get read.
 */
export function LabResultTable({
  results,
  className = "",
}: {
  results: LabResultRow[];
  className?: string;
}) {
  if (results.length === 0) return null;

  return (
    <div className={`overflow-hidden rounded-lg border border-[var(--p-border)] ${className}`}>
      <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-x-3 border-b border-[var(--p-border)] bg-[var(--p-bg)] px-3 py-1.5 text-[9.5px] font-semibold uppercase tracking-wide text-[var(--p-muted)]">
        <span>Test</span>
        <span className="text-right">Result</span>
        <span className="text-right">Reference</span>
      </div>
      <div className="divide-y divide-[var(--p-border)]">
        {results.map((r, i) => {
          const s = FLAG_STYLE[r.flag];
          const off = r.flag !== "NORMAL";
          return (
            <div
              key={`${r.name}-${i}`}
              style={off ? { background: s.tint } : undefined}
              className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-baseline gap-x-3 px-3 py-2"
            >
              <span className="min-w-0 truncate text-[12px] text-[var(--p-ink)]" title={r.name}>
                {r.name}
              </span>

              <span className="text-right tabular-nums" style={{ color: s.ink }}>
                <span className={`text-[12.5px] ${off ? "font-bold" : "font-medium"}`}>{r.value}</span>
                {r.unit && <span className="ml-1 text-[10.5px] text-[var(--p-muted)]">{r.unit}</span>}
                {off && (
                  <span className="ml-1 text-[10px] font-bold" title={s.label} aria-label={s.label}>
                    {s.mark}
                  </span>
                )}
              </span>

              <span className="text-right text-[10.5px] tabular-nums text-[var(--p-muted)]">
                {formatRange(r)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

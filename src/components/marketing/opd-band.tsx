import {
  BOARD_START, BOARD_END, DAY_LABELS, DAY_NAMES,
  allowedDays, boardPct, clockLabel, daysInWords, is24Hours, opdWindow, slotsFor,
} from "@/lib/opd";

/**
 * THE OPD BOARD BAND
 * ---------------------------------------------------------------------------
 * Every hospital in Telangana has one: a painted board in the lobby listing
 * each doctor and the hours they sit. A patient reads it to answer one
 * question - "can I see them tomorrow morning?" - and the answer is a shape,
 * not a sentence.
 *
 * So that's what this is. The rail is the hospital's whole OPD day, 8 AM to
 * 8 PM. The filled segment is this doctor's window inside it. You can see at a
 * glance that the paediatrician is there all day and the neurologist is a
 * morning-only visit, without reading a single number.
 *
 * Everything is derived from the doctor's real `opd` and `days` fields through
 * src/lib/opd.ts - the same parsing the slot picker uses, so the board can
 * never promise a time the booking form would refuse.
 */

const HOUR_TICKS = [8, 10, 12, 14, 16, 18, 20];

export function OpdBand({
  opd, days, variant = "compact", className = "",
}: {
  opd: string;
  days: string;
  /** compact: directory cards. full: the profile page, with ticks and labels. */
  variant?: "compact" | "full";
  className?: string;
}) {
  const win = opdWindow(opd);
  const open = allowedDays(days);
  const full = variant === "full";
  const h24 = is24Hours(opd);
  const byAppt = !win && !h24;

  // Read out in words for anyone not looking at the shape.
  const spoken = h24
    ? `Open 24 hours, ${daysInWords(days)}`
    : byAppt
      ? `By appointment, ${daysInWords(days)}`
      : `Consults ${daysInWords(days)}, ${clockLabel(win!.start)} to ${clockLabel(win!.end)}`;

  // A by-appointment doctor has no diary to draw - say so, keep the day pills.
  if (byAppt) {
    return (
      <div className={className} role="img" aria-label={spoken}>
        <div className="rounded-full bg-[var(--bone-deep)] px-3.5 py-1.5 text-center text-[11px] font-medium text-[var(--muted)]">
          By appointment · booked through the front desk
        </div>
        <DayPills open={open} days={days} full={full} />
      </div>
    );
  }

  const left = win ? boardPct(win.start) : 0;
  const width = win ? Math.max(2, boardPct(win.end) - left) : 100;
  const slots = full && win ? slotsFor(opd) : [];

  return (
    <div className={className} role="img" aria-label={spoken}>
      {full && (
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <span className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[var(--muted)]">
            OPD board
          </span>
          <span className="font-mono text-[11px] text-[var(--teal)]">
            {h24 ? "Open 24 hours" : `${clockLabel(win!.start)} – ${clockLabel(win!.end)}`}
          </span>
        </div>
      )}

      {/* the rail: the hospital's whole consulting day */}
      <div className={`relative w-full rounded-full bg-[var(--bone-deep)] ${full ? "h-[26px]" : "h-[9px]"}`} aria-hidden>
        {/* hour gridlines only make sense for a windowed doctor */}
        {full && !h24 && HOUR_TICKS.slice(1, -1).map((h) => (
          <span
            key={h}
            className="absolute top-0 h-full w-px bg-[var(--line-strong)]/60"
            style={{ left: `${boardPct(h * 60)}%` }}
          />
        ))}

        {/* this doctor's window - a full bar when they're 24-hour */}
        <div
          className="absolute top-0 flex h-full items-center justify-center gap-[3px] overflow-hidden rounded-full bg-[var(--teal)] px-1.5"
          style={{ left: `${left}%`, width: `${width}%` }}
        >
          {h24 && full ? (
            <span className="text-[9px] font-bold uppercase tracking-[0.12em] text-white">Open 24 hours</span>
          ) : (
            full && slots.map((s) => (
              <span key={s} className="h-[9px] w-px flex-1 rounded-full bg-white/45" />
            ))
          )}
        </div>
      </div>

      {full && !h24 && (
        <div className="mt-1.5 flex justify-between font-mono text-[10px] text-[var(--muted)]" aria-hidden>
          {HOUR_TICKS.map((h) => (
            <span key={h}>{h > 12 ? h - 12 : h}</span>
          ))}
        </div>
      )}

      <DayPills open={open} days={days} full={full} />
    </div>
  );
}

/** The Mon-Sat pills, shared by every band variant. */
function DayPills({ open, days, full }: { open: Set<number>; days: string; full: boolean }) {
  return (
    <>
      {/* the days they actually come in */}
      <div className={`flex items-center gap-1 ${full ? "mt-4" : "mt-2"}`} aria-hidden>
        {DAY_LABELS.map((d, i) => {
          const on = open.has(i);
          return (
            <span
              key={i}
              title={`${DAY_NAMES[i]}${on ? "" : " - closed"}`}
              className={`grid place-items-center rounded-full font-mono transition-colors ${
                full ? "h-6 w-6 text-[10.5px]" : "h-[15px] w-[15px] text-[8.5px]"
              } ${
                on
                  ? "bg-[var(--teal-soft)] font-semibold text-[var(--teal-deep)]"
                  : "bg-transparent text-[var(--muted)]/45"
              }`}
            >
              {d}
            </span>
          );
        })}
        {full && (
          <span className="ml-2 text-[12px] text-[var(--ink-soft)]">{daysInWords(days)}</span>
        )}
      </div>
    </>
  );
}

/** The board's scale, printed once above a stack of bands so each row stays clean. */
export function OpdBandScale({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center justify-between font-mono text-[10px] text-[var(--muted)] ${className}`} aria-hidden>
      <span>{clockLabel(BOARD_START)}</span>
      <span className="text-[var(--muted)]/60">OPD day</span>
      <span>{clockLabel(BOARD_END)}</span>
    </div>
  );
}

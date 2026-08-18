"use client";

import { Icon, type IconName } from "./icons";

/** Small inline spinner for button loading states. */
export function Spinner({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className="animate-spin" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/**
 * THE ASTERISK, in one place.
 *
 * Marks a field the form will not submit without. Red and slightly raised, the
 * way every form in the world does it - a convention is worth more than a
 * cleverer marker here, because staff read it without being taught.
 *
 * `aria-hidden` with a text alternative beside it: a screen reader announcing
 * "star" mid-label tells somebody nothing, and the visual asterisk is decoration
 * for the word "required" that follows it.
 *
 * The rule this file enforces by existing: a `*` means the SERVER will refuse
 * this without a value (see the zod validators in src/server/validators). It is
 * not a hint, not a preference, and not "please fill this in if you can" - an
 * asterisk on an optional field teaches a desk to ignore all of them.
 */
export function Req() {
  return (
    <>
      <span aria-hidden className="ml-0.5 font-bold text-[var(--p-rose)]">*</span>
      <span className="sr-only"> (required)</span>
    </>
  );
}

/** Labelled input with a leading icon and optional error/hint line. */
export function Field({
  label, icon, error, children, span, required,
}: {
  label: string; icon?: IconName; error?: string; children: React.ReactNode; span?: boolean;
  /** The form will not submit without this. Draws the asterisk - see Req. */
  required?: boolean;
}) {
  return (
    <div className={span ? "sm:col-span-2" : ""}>
      <label className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.05em] text-[var(--p-muted)]">
        {icon && <span className="text-[var(--p-teal)]"><Icon name={icon} size={13} /></span>}
        <span>{label}{required && <Req />}</span>
      </label>
      {children}
      {error && (
        <p className="mt-1.5 flex items-center gap-1 text-[12px] text-[var(--p-rose)]">
          <Icon name="alert" size={11} /> {error}
        </p>
      )}
    </div>
  );
}

/** Animated success check that draws itself in. */
export function SuccessCheck({ size = 44 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 52 52" aria-hidden>
      <circle
        cx="26" cy="26" r="24" fill="none" stroke="var(--p-teal)" strokeWidth="3"
        strokeDasharray="151" strokeDashoffset="151"
        style={{ animation: "drawLine 0.5s ease forwards" }}
      />
      <path
        d="M15 27l7 7 15-15" fill="none" stroke="var(--p-teal)" strokeWidth="3.5"
        strokeLinecap="round" strokeLinejoin="round"
        strokeDasharray="40" strokeDashoffset="40"
        style={{ animation: "drawLine 0.4s ease 0.4s forwards" }}
      />
    </svg>
  );
}

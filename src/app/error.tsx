"use client";

/**
 * The public site's boundary - the marketing pages and the patient portal.
 *
 * Written against the PUBLIC theme (`--color-ink`, `--color-blue` via Tailwind)
 * rather than reusing the portal's ErrorRecovery, because the `--p-*` tokens it
 * paints with are declared under `.portal` and simply do not exist out here. A
 * shared component would have rendered this in whatever colours the browser
 * defaults to, on the one page whose entire job is to look deliberate.
 *
 * The words are different too, and that is the point: a receptionist is told to
 * try again and report it, because they have someone to report it to. A patient
 * looking for a doctor's timings is told how to reach the hospital, because the
 * only thing they actually wanted was to get in touch.
 */

import Link from "next/link";
import { useEffect } from "react";

export default function PublicError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[public] render failed", error);
  }, [error]);

  return (
    <main className="flex min-h-[70vh] items-center justify-center bg-white px-6 py-20">
      <div className="w-full max-w-lg text-center">
        <h1 className="font-display text-3xl font-bold text-ink">Something went wrong on our side</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-muted">
          This page didn&apos;t load properly. It isn&apos;t anything you did, and nothing you
          typed was submitted.
        </p>

        <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
          <button
            onClick={reset}
            className="rounded-md bg-ink px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-blue-deep"
          >
            Try again
          </button>
          <Link
            href="/"
            className="rounded-md border border-line px-6 py-3 text-sm font-medium text-ink transition-colors hover:border-blue hover:text-blue"
          >
            Back to home
          </Link>
        </div>

        {/* A patient who cannot book online still needs to reach the hospital.
            This is the whole reason the public boundary is not just "try again". */}
        <p className="mt-8 border-t border-line pt-5 text-[13.5px] text-muted">
          Need to book or ask something now? Call the hospital directly —
          reception can do anything this site can.
        </p>

        {error.digest && (
          <p className="mt-4 text-[12px] text-muted">
            Reference <span className="font-mono">{error.digest}</span>
          </p>
        )}
      </div>
    </main>
  );
}

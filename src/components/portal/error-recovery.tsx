"use client";

/**
 * WHAT A DESK SEES WHEN A SCREEN BREAKS.
 *
 * Until this existed there was no `error.tsx` anywhere in the app, which in the
 * App Router means one thing: any render error - a null a component did not
 * expect, a field an API stopped sending - unmounted the tree and left a WHITE
 * PAGE. No message, no way back, nothing in any log the hospital can read. The
 * receptionist's only move was to reload and hope, and if the same data was
 * still there it broke again.
 *
 * The server has been protected from this all along (`handler()` catches, answers
 * 500, records to ErrorLog). The browser had nothing.
 *
 * WHY THIS SITS PER PORTAL RATHER THAN ONCE AT THE ROOT. An `error.tsx` replaces
 * its own segment and leaves the layout above it mounted, so one of these inside
 * each portal keeps the sidebar, the topbar and the session - the desk loses the
 * screen it was on, not the application. A single boundary at the root would
 * take the whole portal down with any one page.
 *
 * TRY AGAIN IS NOT A RELOAD. `reset()` re-renders the failed segment with
 * everything else left alone, so a transient failure - a request that lost the
 * network, a race on first paint - costs one click and no re-login. Reload stays
 * as the second option for when the state itself is bad.
 *
 * DELIBERATELY NOT REPORTED ANYWHERE YET. Sending these to the server needs an
 * endpoint that is unauthenticated to be useful, which makes it a spam target,
 * which needs rate limiting designed first (see TODOS.md). Showing the digest is
 * what makes the failure reportable by a human in the meantime: it is the same
 * id Next puts in the server log, so "screen said A7F3C2" is enough to find it.
 */

import { useEffect } from "react";

export function ErrorRecovery({
  error,
  reset,
  /** Where the user was, so the message names it. */
  where,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  where: string;
}) {
  useEffect(() => {
    // The one place this failure is currently recorded. Kept so a developer with
    // the console open sees the real stack rather than the friendly text.
    console.error(`[${where}] render failed`, error);
  }, [error, where]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-6 py-16">
      <div className="w-full max-w-md rounded-2xl border border-[var(--p-border)] bg-[var(--p-surface)] p-7 text-center shadow-sm">
        <h1 className="text-[16px] font-semibold text-[var(--p-ink)]">This screen stopped responding</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-[var(--p-text)]">
          Nothing you entered was sent, and nothing already saved has changed.
          Try again — if it keeps happening, use the page you came from and tell whoever
          looks after the system.
        </p>

        <div className="mt-5 flex items-center justify-center gap-2.5">
          <button
            onClick={reset}
            className="rounded-lg bg-[var(--p-blue)] px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-[var(--p-blue-deep)]"
          >
            Try again
          </button>
          <button
            onClick={() => window.location.reload()}
            className="rounded-lg border border-[var(--p-border)] px-4 py-2 text-[13px] font-medium text-[var(--p-text)] transition-colors hover:border-[var(--p-blue)] hover:text-[var(--p-blue)]"
          >
            Reload the page
          </button>
        </div>

        {/* The one thing worth copying down. Without it a report is "it broke". */}
        {error.digest && (
          <p className="mt-5 border-t border-[var(--p-border)] pt-3 text-[11.5px] text-[var(--p-muted)]">
            Reference <span className="font-mono font-semibold text-[var(--p-text)]">{error.digest}</span>
          </p>
        )}
      </div>
    </div>
  );
}

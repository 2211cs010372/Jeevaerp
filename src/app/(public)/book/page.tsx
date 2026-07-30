import type { Metadata } from "next";
import { Suspense } from "react";
import { SectionHeading } from "@/components/ui/section-heading";
import { BookingForm } from "@/components/booking/booking-form";
import { RequestCallbackForm } from "@/components/booking/request-callback-form";

export const metadata: Metadata = {
  title: "Book an appointment",
  description:
    "Book a doctor at Jeeva Multispeciality Hospital, Hanamkonda - pick a real slot online, or leave your number and we'll call you back to fix a time.",
  alternates: { canonical: "/book" },
};

export default function BookPage() {
  return (
    <div className="bg-[var(--bone)] pb-24">
      <SectionHeading
        index="Book an appointment"
        title={"Pick a doctor.\nPick a time."}
        subtitle="Choose your department and a slot that suits you. Walk-ins are always welcome too - but booking ahead means you're not waiting."
        meta={
          <>
            <span className="chip chip-dark">Live slots</span>
            <span className="chip chip-dark">No account needed</span>
            <span className="chip chip-dark">Fee shown before you confirm</span>
          </>
        }
      />

      <div className="shell-w pt-14 sm:pt-18">
        {/* BookingForm reads ?doctor= and ?dept= via useSearchParams, which
            defers it to the client on this statically-rendered page. A bare
            <Suspense> with no fallback left an empty <template> in the DOM and
            the whole slot picker simply never appeared - the page looked like
            it had no booking form at all. A real fallback also means the box
            reserves its space instead of the page jumping when it arrives. */}
        <Suspense fallback={
          <div className="card p-8">
            <p className="mono text-[11px] uppercase tracking-[0.16em] text-[var(--muted)]">
              Loading the diary…
            </p>
            <div className="mt-4 h-40 animate-pulse rounded-[var(--r-md)] bg-[var(--bone)]" />
          </div>
        }>
          <BookingForm />
        </Suspense>

        {/* The second door. Plenty of people won't commit to an exact minute
            online - this catches them instead of losing them to the phone. */}
        <div className="mt-16 lg:mt-20">
          <div className="rule-row mb-8">
            <span className="rule-line" />
            <span className="rule-label">Or let us call you</span>
            <span className="rule-line" />
          </div>
          <RequestCallbackForm />
        </div>
      </div>
    </div>
  );
}

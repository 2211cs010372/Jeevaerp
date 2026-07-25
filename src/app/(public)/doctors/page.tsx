import type { Metadata } from "next";
import { Suspense } from "react";
import { SectionHeading } from "@/components/ui/section-heading";
import { DoctorsDirectory } from "@/components/marketing/doctors-directory";
import { DOCTORS } from "@/lib/data";

export const metadata: Metadata = {
  title: "Our doctors",
  description:
    "Consultants across eight departments at Jeeva Multispeciality Hospital, Hanamkonda. See each doctor's OPD hours, consulting days and fee, then book.",
};

export default function DoctorsPage() {
  return (
    <div className="pb-8">
      <SectionHeading
        index="Our doctors"
        title="Find the right specialist."
        subtitle="Open a profile to see when a consultant actually sits, what they treat and what the visit costs - then book the slot that suits you."
      />
      <div className="mt-10">
        {/* the directory reads ?q= and ?dept=, so it needs a boundary */}
        <Suspense fallback={<div className="mx-auto max-w-[1200px] px-5 py-20 text-center text-[14px] text-[var(--muted)] lg:px-8">Loading doctors…</div>}>
          <DoctorsDirectory doctors={DOCTORS} />
        </Suspense>
      </div>
    </div>
  );
}

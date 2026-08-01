import { DoctorCard } from "@/components/marketing/doctor-card";
import { DOCTORS } from "@/lib/data";
import { Chapter, ChapterHead } from "./section";
import { Stagger } from "./motion";

/**
 * Chapter 04 - the consulting panel.
 *
 * Portraits, not avatars-with-badges: the card is the shared DoctorCard, the
 * same one the /doctors directory uses, so a consultant looks like the same
 * person in both places.
 *
 * THE FEE USED TO BE HERE AND IS NOT ANY MORE. The old note on this chapter
 * argued for publishing it on the card, on the grounds that finding out the
 * price at the counter is the thing this hospital has decided not to do. That
 * argument still holds - the fee is published on every consultant's profile and
 * again in the booking flow, so it is never a surprise at the desk. It is only
 * off the browsing card. The lede above still promises the fee is published
 * before you book, which remains true.
 */
export function SpecializedDoctors() {
  const featured = DOCTORS.slice(0, 8);

  return (
    <Chapter id="doctors" tone="paper">
      <ChapterHead
        index="04"
        label="The panel"
        lines={[{ text: "The people who" }, { text: "will treat you." }]}
        lede="Every consultant here is named, with their qualification, their days and their fee published before you book. You should know who you are seeing."
        action={{ href: "/doctors", label: `All ${DOCTORS.length} consultants` }}
      />

      <Stagger
        each={0.06}
        y={28}
        className="mt-14 grid grid-cols-2 gap-3 sm:mt-18 md:grid-cols-3 lg:grid-cols-4"
      >
        {featured.map((d) => (
          <DoctorCard key={d.id} doctor={d} />
        ))}
      </Stagger>
    </Chapter>
  );
}

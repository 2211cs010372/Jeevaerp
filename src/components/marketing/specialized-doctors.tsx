import Link from "next/link";
import { ArrowUpRight } from "@/components/ui/hugeicons";
import { DoctorCard } from "./doctor-card";
import { listPublicDoctors } from "@/server/services/public-doctors.service";
import { Reveal, Stagger } from "./motion";
import { PosterIntro, POSTER_SECTION } from "./poster-intro";

/**
 * Chapter 02 - the consulting panel.
 *
 * Same composition as the hero and Why Jeeva: plain white, 1.5rem edges, small
 * Montserrat columns across the top, one Instrument Serif headline. Then the
 * panel as a tight grid of cards - 8px apart, 10px corners, a 4:5 picture over
 * the name, the speciality and the days they consult.
 *
 * THE PICTURE IS THE CONSULTANT'S OWN PHOTO WHEN ONE EXISTS (Doctor.photoUrl,
 * uploaded under Admin -> HR), and their speciality's photograph until then -
 * an ultrasound print for gynaecology, a stethoscope for medicine. Never a
 * stock face: see lib/speciality-images.ts for why. A card without its own
 * photo carries the doctor's monogram on the picture, so it is clear the
 * picture is of the work and the monogram is the person.
 *
 * Held to a centred track (about 1180px) so four across reads as a set of
 * cards rather than four posters: not big, not small.
 *
 *   phone  2 across · iPad 3 across · desktop 4 across
 *
 * No fee anywhere on the card, or anywhere else on the public site.
 */
export async function SpecializedDoctors() {
  const panel = await listPublicDoctors();
  const featured = panel.slice(0, 8);

  return (
    <section id="doctors" className={POSTER_SECTION}>
      <PosterIntro
        index="02"
        label="The panel"
        aside={["Named.", "Qualified.", "On the record."]}
        lede="Every consultant here is named, with their qualification and the days they consult on the record before you book. You should know who you are seeing."
        action={{ href: "/doctors", label: "All consultants" }}
        lines={[{ text: "The people who" }, { text: "will treat you.", className: "italic text-[var(--teal)]" }]}
      />

      {/* ── the cards ────────────────────────────────────────────────── */}
      <div className="mx-auto mt-[clamp(2rem,4vw,3rem)] max-w-[1180px]">
        <Stagger each={0.05} y={18} className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-4">
          {featured.map((d) => (
            <DoctorCard key={d.id} doctor={d} />
          ))}
        </Stagger>

        <Reveal y={10} className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[12.5px] font-medium text-[var(--muted)]">
            Days, hours and live slots are on every consultant&apos;s profile.
          </p>
          <Link href="/doctors" className="btn-ghost-sm self-start sm:self-auto">
            Browse the full panel <ArrowUpRight size={14} />
          </Link>
        </Reveal>
      </div>
    </section>
  );
}

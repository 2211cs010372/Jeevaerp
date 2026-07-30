import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { DoctorAvatar } from "@/components/marketing/doctor-avatar";
import { DOCTORS } from "@/lib/data";
import { Chapter, ChapterHead } from "./section";
import { Stagger } from "./motion";

/**
 * Chapter 04 - the consulting panel.
 *
 * Portraits, not avatars-with-badges. Each card carries the four facts a
 * family actually weighs before booking - who, in what, on which days, at what
 * fee - and the fee is on the card rather than behind the booking flow,
 * because finding out the price at the counter is the thing this hospital has
 * decided not to do.
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
        className="mt-14 grid grid-cols-1 gap-x-6 gap-y-10 sm:mt-18 sm:grid-cols-2 lg:grid-cols-4"
      >
        {featured.map((d) => (
          <Link key={d.id} href={`/doctors/${d.id}`} className="group block">
            <div className="media-frame zoom-media relative aspect-[3/4] bg-[var(--bone)]">
              <DoctorAvatar
                name={d.name}
                image={d.image}
                className="h-full w-full object-cover text-3xl"
              />

              <span className="mono absolute left-4 top-4 z-10 rounded-full bg-black/35 px-2.5 py-1 text-[9.5px] uppercase tracking-[0.14em] text-white backdrop-blur">
                {d.experience} yrs
              </span>
              <span
                aria-hidden
                className="absolute right-4 top-4 z-10 grid h-9 w-9 place-items-center rounded-full bg-white/90 text-[var(--ink)] transition-all duration-400 group-hover:rotate-45 group-hover:bg-[var(--teal)] group-hover:text-white"
              >
                <ArrowUpRight className="h-4 w-4" />
              </span>

              <div className="absolute inset-x-4 bottom-4 z-10">
                <p className="mono text-[9.5px] uppercase tracking-[0.16em] text-[var(--teal-tint)]">
                  {d.department}
                </p>
                <h3 className="mt-1.5 text-[16px] font-semibold leading-tight tracking-[-0.02em] text-white">
                  {d.name}
                </h3>
                <p className="mt-0.5 line-clamp-1 text-[11.5px] text-white/70">
                  {d.specialization}
                </p>
              </div>
            </div>

            {/* the practical row, ruled off from the portrait */}
            <dl className="mt-3.5 flex items-center justify-between border-t border-[var(--line)] pt-3">
              <div>
                <dt className="sr-only">OPD hours</dt>
                <dd className="mono text-[11px] text-[var(--ink-soft)]">{d.opd}</dd>
                <dt className="sr-only">Consulting days</dt>
                <dd className="mono mt-1 text-[10px] uppercase tracking-[0.12em] text-[var(--muted)]">
                  {d.days}
                </dd>
              </div>
              <div className="text-right">
                <dt className="sr-only">Consultation fee</dt>
                <dd className="mono text-[15px] font-semibold tabular text-[var(--ink)]">
                  ₹{d.fee}
                </dd>
                <dd className="mono text-[9.5px] uppercase tracking-[0.12em] text-[var(--muted)]">
                  per visit
                </dd>
              </div>
            </dl>
          </Link>
        ))}
      </Stagger>
    </Chapter>
  );
}

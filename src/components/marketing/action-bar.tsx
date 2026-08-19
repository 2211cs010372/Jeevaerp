import Link from "next/link";
import { Search, CalendarCheck, Bed, PhoneCall, ArrowUpRight } from "@/components/ui/hugeicons";
import { HOSPITAL } from "@/lib/data";
import { listPublicDoctors } from "@/server/services/public-doctors.service";
import { Stagger } from "./motion";

/**
 * The four fast lanes.
 *
 * This band exists because most people arriving here have already decided what
 * they want before the page finishes loading: a doctor, a slot, a room rate, or
 * a phone call. It sits directly under the marquee so none of those four ever
 * needs a scroll.
 *
 * NOW CARDS, AND WHY THAT IS NOT A REVERSAL. The old note here argued for a
 * hairline row over cards, on the grounds that "cards with gradients and
 * shadows read as advertising". The objection was to the gradients and the
 * shadows, not to the card - and the reference site's cards have neither. These
 * are flat panels separated by a value step, with 10px corners and no border at
 * all, which still reads as a directory rather than a billboard while giving
 * each lane a tap target with an actual edge to it.
 */
const lanes = (consultants: number) => [
  {
    href: "/doctors",
    title: "Find a doctor",
    sub: "By name, specialty or condition",
    meta: `${consultants}+ consultants`,
    icon: Search,
  },
  {
    href: "/book",
    title: "Book an appointment",
    sub: "Pick a live slot, no phone call",
    meta: "Same-day slots",
    icon: CalendarCheck,
  },
  {
    href: "/#wards",
    title: "Rooms & prices",
    sub: "Every ward rate, published",
    meta: "From ₹1,500/day",
    icon: Bed,
  },
];

/* One padding scale for all four lanes. The emergency lane used to run px-4
   against the others' px-1, so on a phone the red card's text sat on a
   different left edge to everything above it. */
const CARD =
  "group relative flex min-h-[9.5rem] flex-col justify-between gap-7 rounded-[10px] p-5 transition-colors duration-250 sm:p-6";

export async function ActionBar() {
  const consultants = (await listPublicDoctors()).length;
  const emergency = HOSPITAL.emergency.replace(/\s/g, "");

  return (
    <section className="bg-[var(--paper)]" aria-label="Quick actions">
      <div className="shell-w py-6 sm:py-8">
        <Stagger
          each={0.07}
          y={20}
          className="grid grid-cols-2 gap-3 sm:grid-cols-2 lg:grid-cols-4"
        >
          {lanes(consultants).map((l) => {
            const Icon = l.icon;
            return (
              <Link
                key={l.title}
                href={l.href}
                className={`${CARD} bg-[var(--bone)] hover:bg-[var(--bone-deep)]`}
              >
                <div className="flex items-start justify-between gap-4">
                  <Icon
                    aria-hidden
                    className="h-5 w-5 text-[var(--teal)]"
                    strokeWidth={1.6}
                  />
                  {/* 10.5px, not 9.5px - the old size put --muted on white
                      under the contrast floor for text that small */}
                  <span className="mono text-[10.5px] uppercase tracking-[0.14em] text-[var(--muted)]">
                    {l.meta}
                  </span>
                </div>

                <div>
                  <h3 className="flex items-center gap-2 text-[16.5px] font-semibold tracking-[-0.02em] text-[var(--ink)]">
                    {l.title}
                    <ArrowUpRight
                      aria-hidden
                      className="h-4 w-4 shrink-0 text-[var(--muted)] transition-transform duration-400 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-[var(--teal)]"
                    />
                  </h3>
                  <p className="mt-1.5 text-[13px] leading-snug text-[var(--ink-soft)]">
                    {l.sub}
                  </p>
                </div>
              </Link>
            );
          })}

          {/* The fourth lane is a phone call, and it is the only red one.
              Hover deepens the tint rather than flooding the card in alarm
              red: the flood repainted four things at once, and left the pulse
              ring drawing red-on-red because .pulse-alert::after has no hover
              state to invert with it. */}
          <a
            href={`tel:${emergency}`}
            className={`${CARD} bg-[var(--alert-soft)] hover:bg-[var(--alert)]/15`}
          >
            <div className="flex items-start justify-between gap-4">
              <PhoneCall
                aria-hidden
                className="h-5 w-5 text-[var(--alert)]"
                strokeWidth={1.6}
              />
              <span className="mono flex items-center gap-2 text-[10.5px] uppercase tracking-[0.14em] text-[var(--alert)]">
                <span className="pulse pulse-alert" />
                Always open
              </span>
            </div>

            <div>
              <h3 className="text-[16.5px] font-semibold tracking-[-0.02em] text-[var(--alert)]">
                Emergency 24×7
              </h3>
              {/* the number itself, not just a label - somebody reading this on
                  a desktop needs to be able to copy it, not tap it */}
              <p className="mono mt-1.5 text-[13px] font-semibold text-[var(--alert-deep)]">
                {HOSPITAL.emergency}
              </p>
            </div>
          </a>
        </Stagger>
      </div>
    </section>
  );
}

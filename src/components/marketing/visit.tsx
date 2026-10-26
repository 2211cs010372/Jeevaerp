import Image from "next/image";
import { ArrowUpRight } from "@/components/ui/hugeicons";
import { HOSPITAL, IMAGES } from "@/lib/data";
import { Reveal, Stagger } from "./motion";
import { PosterIntro, POSTER_SECTION } from "./poster-intro";

/**
 * Chapter 07 - where we are and when we are open.
 *
 * The map on one side, the facts on hairline rows on the other: address, OPD
 * hours, the desk's phone and email, and the emergency line - the only red row.
 * Under the facts, the building itself, small and cut out, the same picture
 * the hero opens on, so the page ends where it began and somebody arriving
 * knows what to look for from the road.
 *
 * THE MAP IS EMBEDDED, NOT LINKED. A link to Google Maps is a link away from
 * the site, taken by somebody usually already in a car park. The embed answers
 * "is this the building I can see" without leaving; "Directions" is still there
 * for turn-by-turn. Queried by the full address so the pin lands on the
 * hospital, and lazy, so nobody who never scrolls this far pays for it.
 *
 *   phone   map, then the facts
 *   iPad    side by side, the map at 4:5 and card-sized (5/12, ~300px)
 *   desktop the map wider (7/12), the facts beside it
 */
const MAP_EMBED = `https://www.google.com/maps?q=${encodeURIComponent(HOSPITAL.address)}&output=embed`;

export function Visit() {
  const tel = HOSPITAL.phone.replace(/\s/g, "");
  const emergency = HOSPITAL.emergency.replace(/\s/g, "");

  const rows = [
    { label: "Address", body: <span className="max-w-[34ch]">{HOSPITAL.address}</span> },
    { label: "OPD hours", body: <>{HOSPITAL.opdHours} · {HOSPITAL.opdDays}</> },
    {
      label: "Front desk",
      body: (
        <>
          <a href={`tel:${tel}`} className="block tabular-nums transition-colors hover:text-[var(--teal)]">
            {HOSPITAL.phone}
          </a>
          <a href={`mailto:${HOSPITAL.email}`} className="mt-0.5 block break-all text-[12.5px] text-[var(--muted)] transition-colors hover:text-[var(--teal)]">
            {HOSPITAL.email}
          </a>
        </>
      ),
    },
  ];

  return (
    <section id="visit" className={POSTER_SECTION}>
      <PosterIntro
        index="07"
        label="Visit us"
        aside={["Parking at the gate.", "Step-free entrance.", "A person on the phone."]}
        lede="Find us in Hanamkonda, near Asian Cinema. Walk in for the OPD, or call ahead and the desk will have your file ready."
        action={{ href: HOSPITAL.mapUrl, label: "Open in Google Maps", external: true }}
        lines={[{ text: "Easy to find," }, { text: "open all day.", className: "italic text-[var(--teal)]" }]}
      />

      <div className="mt-[clamp(2rem,4vw,3rem)] grid gap-6 md:grid-cols-12">
        {/* the map */}
        <Reveal y={20} className="md:col-span-5 lg:col-span-7">
          <div className="relative aspect-[4/5] overflow-hidden rounded-[12px] bg-[var(--bone)] lg:aspect-[16/11]">
            <iframe
              src={MAP_EMBED}
              title={`Map showing ${HOSPITAL.name}, ${HOSPITAL.locality}`}
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              className="absolute inset-0 h-full w-full border-0 grayscale-[0.35]"
            />
            <a
              href={HOSPITAL.mapUrl}
              target="_blank"
              rel="noreferrer"
              className="btn-ghost-sm absolute bottom-3 left-3 z-10 border-transparent bg-white hover:bg-white"
            >
              Directions <ArrowUpRight size={14} />
            </a>
          </div>
        </Reveal>

        {/* the facts */}
        <div className="flex flex-col md:col-span-7 lg:col-span-5">
          <Stagger each={0.06} y={14} className="border-b border-[var(--line-strong)]">
            {rows.map((r) => (
              <div key={r.label} className="grid grid-cols-[7.5rem_1fr] gap-4 border-t border-[var(--line-strong)] py-4">
                <span className="text-[12px] font-medium text-[var(--muted)]">{r.label}</span>
                <span className="text-[14px] font-medium leading-[1.3] text-[var(--ink)]">{r.body}</span>
              </div>
            ))}
            <a
              href={`tel:${emergency}`}
              className="group grid grid-cols-[7.5rem_1fr] gap-4 border-t border-[var(--line-strong)] py-4"
            >
              <span className="flex items-center gap-2 text-[12px] font-medium text-[var(--alert)]">
                <span className="pulse pulse-alert" aria-hidden /> Emergency
              </span>
              <span className="flex items-center justify-between gap-3 text-[14px] font-medium text-[var(--alert)]">
                <span className="tabular-nums">{HOSPITAL.emergency} · 24×7</span>
                <ArrowUpRight size={14} className="transition-transform duration-300 group-hover:rotate-45" />
              </span>
            </a>
          </Stagger>

          {/* the building, so it is recognisable from the road */}
          <Reveal y={16} className="mx-auto mt-auto w-[min(100%,360px)] pt-8">
            <Image
              src={IMAGES.heroBuilding}
              alt={`${HOSPITAL.name} from the road`}
              width={1272}
              height={903}
              sizes="360px"
              className="h-auto w-full"
            />
          </Reveal>
        </div>
      </div>
    </section>
  );
}

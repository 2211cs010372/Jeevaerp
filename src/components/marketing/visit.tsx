import { ArrowUpRight } from "lucide-react";
import { SmartImage } from "@/components/ui/smart-image";
import { Vitals } from "@/components/marketing/vitals";
import { HOSPITAL } from "@/lib/data";
import { Chapter, ChapterHead } from "./section";
import { Parallax, Reveal } from "./motion";

/**
 * Chapter 09 - where we are and when we are open.
 *
 * The most-used page content on any hospital site, and usually the worst laid
 * out. Address, hours and phone are set as a mono data block on hairlines - a
 * shape you can read at a traffic light on a phone - with the photograph
 * beside it so the front of the building is recognisable on arrival.
 */
export function Visit() {
  return (
    <Chapter id="visit" tone="paper">
      <ChapterHead
        index="09"
        label="Visit us"
        lines={[{ text: "Easy to find," }, { text: "open all day." }]}
        lede="Parking at the gate, wheelchair access at the main entrance, and a person on the other end of the phone."
        action={{ href: HOSPITAL.mapUrl, label: "Open in Google Maps" }}
      />

      <div className="mt-14 grid gap-4 sm:mt-18 lg:grid-cols-12">
        <Reveal className="lg:col-span-6" y={30}>
          <div className="media-frame relative aspect-[16/11] lg:h-full">
            <Parallax amount={9} className="absolute inset-0 h-[112%] -top-[6%]">
              <SmartImage
                src="/images/hospital_banner.jpeg"
                alt={`${HOSPITAL.name}, ${HOSPITAL.locality}`}
                label="Hospital exterior"
                className="h-full w-full object-cover"
              />
            </Parallax>
            <a
              href={HOSPITAL.mapUrl}
              target="_blank"
              rel="noreferrer"
              className="btn btn-light absolute bottom-6 left-6 z-10"
            >
              Open in Maps <ArrowUpRight className="h-4 w-4" />
            </a>
          </div>
        </Reveal>

        <Reveal className="lg:col-span-6" y={30} delay={0.1}>
          <dl className="grid-lines h-full rounded-[var(--r-xl)] border border-[var(--line)] !border-t-[var(--line-strong)] bg-[var(--bone)] px-7 sm:px-9">
            <Row label="Address">
              <p className="max-w-md text-[15px] leading-[1.7] text-[var(--ink)]">
                {HOSPITAL.address}
              </p>
            </Row>

            <Row label="Hours">
              <p className="mono text-[14.5px] text-[var(--ink)]">OPD · {HOSPITAL.opdHours}</p>
              <p className="mt-1 text-[13px] text-[var(--muted)]">Seven days, including Sunday.</p>
              <p className="mono mt-4 text-[14.5px] font-semibold text-[var(--alert)]">
                Emergency · 24×7
              </p>
              <p className="mt-1 text-[13px] text-[var(--muted)]">
                Every day, including holidays. Walk straight in.
              </p>
            </Row>

            <Row label="Contact" last>
              <a
                href={`tel:${HOSPITAL.phone.replace(/\s/g, "")}`}
                className="mono block text-[14.5px] text-[var(--ink)] transition-colors hover:text-[var(--teal)]"
              >
                {HOSPITAL.phone}
              </a>
              <a
                href={`mailto:${HOSPITAL.email}`}
                className="mt-2 block break-all text-[13px] text-[var(--muted)] transition-colors hover:text-[var(--teal)]"
              >
                {HOSPITAL.email}
              </a>
            </Row>
          </dl>
        </Reveal>
      </div>

      <Reveal className="mt-16 lg:mt-20">
        <Vitals />
      </Reveal>
    </Chapter>
  );
}

function Row({
  label,
  children,
  last = false,
}: {
  label: string;
  children: React.ReactNode;
  last?: boolean;
}) {
  return (
    <div className={`py-7 sm:py-8 ${last ? "!border-b-0" : ""}`}>
      <dt className="mono text-[10px] uppercase tracking-[0.2em] text-[var(--muted)]">{label}</dt>
      <dd className="mt-3.5">{children}</dd>
    </div>
  );
}

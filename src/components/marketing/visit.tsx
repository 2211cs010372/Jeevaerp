import { ArrowUpRight, Clock, Mail, MapPin, Phone } from "lucide-react";
import { SmartImage } from "@/components/ui/smart-image";
import { Vitals } from "@/components/marketing/vitals";
import { HOSPITAL } from "@/lib/data";
import { Chapter, ChapterHead } from "./section";
import { Reveal, Stagger } from "./motion";

/**
 * Chapter 09 - where we are and when we are open.
 *
 * The most-used content on any hospital site, and usually the worst laid out.
 * Built as a bento in chapter 01's grammar: the map takes the deepest cell, the
 * building takes a photograph so it is recognisable on arrival, and address,
 * hours, phone and the emergency number are each their own cell rather than
 * rows of a table nobody scans.
 *
 * THE MAP IS EMBEDDED, NOT LINKED. A link to Google Maps is a link away from
 * the site, taken by somebody who is usually already in a car park. The embed
 * answers "is this the building I can see" without a navigation, and the
 * open-in-maps link is still there for the people who do want turn-by-turn.
 *
 * It is queried by the full published address rather than by the town, so the
 * pin lands on the hospital rather than on Hanamkonda generally. Loaded lazily:
 * this chapter sits nine screens down, and an eager third-party iframe would be
 * paid for by every visitor who never reaches it.
 */
const MAP_EMBED = `https://www.google.com/maps?q=${encodeURIComponent(
  HOSPITAL.address,
)}&output=embed`;

export function Visit() {
  const tel = HOSPITAL.phone.replace(/\s/g, "");
  const emergency = HOSPITAL.emergency.replace(/\s/g, "");

  return (
    <Chapter id="visit" tone="paper">
      <ChapterHead
        index="09"
        label="Visit us"
        lines={[{ text: "Easy to find," }, { text: "open all day." }]}
        lede="Parking at the gate, wheelchair access at the main entrance, and a person on the other end of the phone."
        action={{ href: HOSPITAL.mapUrl, label: "Open in Google Maps" }}
      />

      <Stagger
        each={0.07}
        y={22}
        className="mt-12 grid gap-3 sm:mt-16 sm:grid-cols-2 lg:grid-cols-4"
      >
        {/* the map - deepest cell, and the reason most people opened this */}
        <div className="relative min-h-[20rem] overflow-hidden rounded-[16px] bg-[var(--bone)] sm:col-span-2 lg:row-span-2">
          <iframe
            src={MAP_EMBED}
            title={`Map showing ${HOSPITAL.name}, ${HOSPITAL.locality}`}
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            className="absolute inset-0 h-full w-full border-0"
          />
          <a
            href={HOSPITAL.mapUrl}
            target="_blank"
            rel="noreferrer"
            className="btn btn-light absolute bottom-4 left-4 z-10 shadow-[var(--shadow-sm)]"
          >
            Directions <ArrowUpRight className="h-4 w-4" />
          </a>
        </div>

        {/* the building, so it is recognisable from the road */}
        <div className="relative min-h-[13rem] overflow-hidden rounded-[16px] bg-[var(--bone)] sm:col-span-2">
          <SmartImage
            src="/images/hospital_banner.jpeg"
            alt={`${HOSPITAL.name}, ${HOSPITAL.locality}`}
            label="Hospital exterior"
            className="absolute inset-0 h-full w-full brightness-[0.55]"
          />
          <div
            aria-hidden
            className="absolute inset-0 bg-gradient-to-t from-[var(--pine-ink)]/88 via-[var(--pine-ink)]/30 to-transparent"
          />
          <div className="absolute inset-x-0 bottom-0 z-10 p-6">
            <p className="mono text-[10px] uppercase tracking-[0.2em] text-white/65">
              {HOSPITAL.locality}
            </p>
            <p className="display-sm mt-2 max-w-[24ch] text-white">
              {HOSPITAL.name}
            </p>
          </div>
        </div>

        <Cell icon={<MapPin className="h-3.5 w-3.5" />} label="Address" className="sm:col-span-2">
          <p className="max-w-[34ch] text-[14.5px] leading-[1.7] text-[var(--ink)]">
            {HOSPITAL.address}
          </p>
        </Cell>

        <Cell icon={<Clock className="h-3.5 w-3.5" />} label="OPD hours">
          <p className="mono text-[14.5px] text-[var(--ink)]">{HOSPITAL.opdHours}</p>
          <p className="mt-1.5 text-[13px] leading-[1.6] text-[var(--muted)]">
            {HOSPITAL.opdDays}.
          </p>
        </Cell>

        <Cell icon={<Phone className="h-3.5 w-3.5" />} label="Contact">
          <a
            href={`tel:${tel}`}
            className="mono block text-[14.5px] text-[var(--ink)] transition-colors hover:text-[var(--teal)]"
          >
            {HOSPITAL.phone}
          </a>
          <a
            href={`mailto:${HOSPITAL.email}`}
            className="mt-2 flex items-start gap-1.5 break-all text-[12.5px] leading-[1.5] text-[var(--muted)] transition-colors hover:text-[var(--teal)]"
          >
            <Mail className="mt-[3px] h-3 w-3 shrink-0" aria-hidden />
            {HOSPITAL.email}
          </a>
        </Cell>

        {/* the only red cell, and it is a phone number rather than a promotion */}
        <a
          href={`tel:${emergency}`}
          className="group flex flex-col justify-between rounded-[16px] bg-[var(--alert-soft)] p-5 transition-colors duration-250 hover:bg-[var(--alert)]/15 sm:col-span-2 sm:p-6"
        >
          <p className="mono flex items-center gap-2.5 text-[10px] uppercase tracking-[0.18em] text-[var(--alert)]">
            <span className="pulse pulse-alert" /> Emergency · 24×7
          </p>
          <div className="mt-8">
            <p className="mono text-[16px] font-semibold text-[var(--alert-deep)]">
              {HOSPITAL.emergency}
            </p>
            <p className="mt-1.5 text-[13px] leading-[1.6] text-[var(--ink-soft)]">
              Every day, including holidays. Walk straight in - no appointment,
              no registration first.
            </p>
          </div>
        </a>
      </Stagger>

      <Reveal className="mt-16 lg:mt-20">
        <Vitals />
      </Reveal>
    </Chapter>
  );
}

/** One fact about getting here, on its own cell. */
function Cell({
  icon,
  label,
  children,
  className = "",
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-col justify-between rounded-[16px] bg-[var(--bone)] p-5 sm:p-6 ${className}`}
    >
      <p className="mono flex items-center gap-2.5 text-[10px] uppercase tracking-[0.18em] text-[var(--muted)]">
        <span aria-hidden>{icon}</span>
        {label}
      </p>
      <div className="mt-8">{children}</div>
    </div>
  );
}

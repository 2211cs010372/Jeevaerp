import Link from "next/link";
import { Search, CalendarCheck, Bed, PhoneCall, ArrowUpRight } from "lucide-react";
import { HOSPITAL, DOCTORS } from "@/lib/data";
import { Stagger } from "./motion";

/**
 * The four fast lanes.
 *
 * This band exists because most people arriving here have already decided what
 * they want before the page finishes loading: a doctor, a slot, a room rate, or
 * a phone call. It sits directly under the marquee so none of those four ever
 * needs a scroll.
 *
 * Built as one hairline-divided row rather than four floating cards. Cards with
 * gradients and shadows read as advertising; a ruled row reads as a directory,
 * which is what it is.
 */
const LANES = [
  {
    href: "/doctors",
    title: "Find a doctor",
    sub: "By name, specialty or condition",
    meta: `${DOCTORS.length}+ consultants`,
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
] as const;

export function ActionBar() {
  const emergency = HOSPITAL.emergency.replace(/\s/g, "");

  return (
    <section className="bg-[var(--paper)]" aria-label="Quick actions">
      <div className="shell-w">
        <Stagger
          each={0.07}
          y={20}
          className="grid grid-cols-1 border-b border-[var(--line)] sm:grid-cols-2 lg:grid-cols-4"
        >
          {LANES.map((l) => {
            const Icon = l.icon;
            return (
              <Link
                key={l.title}
                href={l.href}
                className="group relative flex flex-col justify-between gap-7 border-t border-[var(--line)] px-1 py-7 transition-colors hover:bg-[var(--bone)] sm:px-6 sm:py-8 lg:border-l lg:first:border-l-0"
              >
                <div className="flex items-start justify-between gap-4">
                  <Icon className="h-5 w-5 text-[var(--teal)]" strokeWidth={1.6} />
                  <span className="mono text-[9.5px] uppercase tracking-[0.16em] text-[var(--muted)]">
                    {l.meta}
                  </span>
                </div>
                <div>
                  <h3 className="flex items-center gap-2 text-[16.5px] font-semibold tracking-[-0.02em] text-[var(--ink)]">
                    {l.title}
                    <ArrowUpRight
                      className="h-4 w-4 shrink-0 text-[var(--muted)] transition-all duration-400 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-[var(--teal)]"
                    />
                  </h3>
                  <p className="mt-1.5 text-[13px] leading-snug text-[var(--ink-soft)]">
                    {l.sub}
                  </p>
                </div>
              </Link>
            );
          })}

          {/* the fourth lane is a phone call, and it is the only red one */}
          <a
            href={`tel:${emergency}`}
            className="group relative flex flex-col justify-between gap-7 border-t border-[var(--line)] bg-[var(--alert-soft)] px-4 py-7 transition-colors hover:bg-[var(--alert)] sm:px-6 sm:py-8 lg:border-l"
          >
            <div className="flex items-start justify-between gap-4">
              <PhoneCall className="h-5 w-5 text-[var(--alert)] transition-colors group-hover:text-white" strokeWidth={1.6} />
              <span className="mono flex items-center gap-2 text-[9.5px] uppercase tracking-[0.16em] text-[var(--alert)] transition-colors group-hover:text-white/80">
                <span className="pulse pulse-alert group-hover:!bg-white" />
                Always open
              </span>
            </div>
            <div>
              <h3 className="text-[16.5px] font-semibold tracking-[-0.02em] text-[var(--alert)] transition-colors group-hover:text-white">
                Emergency 24×7
              </h3>
              <p className="mono mt-1.5 text-[13px] font-semibold text-[var(--alert-deep)] transition-colors group-hover:text-white">
                {HOSPITAL.emergency}
              </p>
            </div>
          </a>
        </Stagger>
      </div>
    </section>
  );
}

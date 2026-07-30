import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { HOSPITAL } from "@/lib/data";
import { Chapter } from "./section";
import { Magnetic, Reveal, SplitLead } from "./motion";

/**
 * The closing ask - the third and last dark room, running straight into the
 * footer so the page ends on one continuous field of pine rather than a
 * stack of dark boxes with porcelain seams between them.
 *
 * Two doors, deliberately unequal. Booking is the primary act and gets the
 * solid button; the patient portal is for people who have already been here
 * and gets a quieter one.
 */
export function PortalCta() {
  return (
    <Chapter tone="dark" className="chapter-flush-b">
      <div className="rule-row rule-row-dark">
        <span className="rule-idx">(11)</span>
        <span className="rule-line" />
        <span className="rule-label">Get seen</span>
      </div>

      <div className="mt-12 grid gap-12 sm:mt-16 lg:grid-cols-12 lg:items-end">
        <div className="lg:col-span-7">
          <SplitLead
            as="h2"
            className="display-lead text-white"
            lines={[{ text: "Don't wait" }, { text: "on your health." }]}
          />
          <Reveal as="p" delay={0.1} y={18} className="lede mt-7 text-white/65">
            OPD runs {HOSPITAL.opdHours}, seven days a week, and the emergency
            door never closes. Booking takes about a minute and holds you a real
            slot with a named consultant.
          </Reveal>
        </div>

        <Reveal className="lg:col-span-5" delay={0.18} y={22}>
          <div className="flex flex-wrap items-center gap-3">
            <Magnetic>
              <Link href="/book" className="btn btn-light">
                Book an appointment <ArrowUpRight className="h-4 w-4" />
              </Link>
            </Magnetic>
            <Link href="/portal/login" className="btn btn-ghost-dark">
              Patient portal
            </Link>
          </div>
          <p className="mt-6 max-w-sm text-[13.5px] leading-[1.7] text-white/50">
            Already visited? Sign in with your Jeeva ID to pull up every report,
            prescription and bill you have ever had here.
          </p>
        </Reveal>
      </div>
    </Chapter>
  );
}

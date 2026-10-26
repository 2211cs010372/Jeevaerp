import { Phone } from "@/components/ui/hugeicons";
import { HOSPITAL } from "@/lib/data";
import { Reveal, SplitLead } from "./motion";

/**
 * The one loud thing on the page, and it is for emergencies only.
 *
 * Alert red, a colour that appears nowhere else on the site except the
 * emergency line in the header and the hero - its whole value is that it is
 * unique. Slimmer than it was: one serif line and one tap target, at the
 * page's 1.5rem edges, so it reads as the last instruction rather than a
 * second hero.
 *
 * The instruction leads, not the branding. Somebody scanning this in a panic
 * needs "don't book, come in" before the number, and the number needs to be
 * a tap target rather than a piece of typography.
 */
export function EmergencyBand() {
  const emergency = HOSPITAL.emergency.replace(/\s/g, "");

  return (
    <section
      aria-labelledby="emergency-heading"
      className="f-sans bg-[var(--alert)] px-[1.5rem] py-[clamp(2.5rem,5vw,3.5rem)] text-white"
    >
      <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="flex items-center gap-2 text-[12px] font-medium text-white/75">
            <span className="h-1.5 w-1.5 rounded-full bg-white" aria-hidden /> Emergency · 24×7
          </p>
          <SplitLead
            as="h2"
            id="emergency-heading"
            className="f-serif mt-3 text-[clamp(2.2rem,4.4vw,4rem)] leading-[0.95] tracking-[-0.02em]"
            lines={[{ text: "Don't book." }, { text: "Come straight in.", className: "italic" }]}
          />
          <Reveal as="p" delay={0.1} y={12} className="mt-3 max-w-[44ch] text-[13.5px] font-medium leading-[1.3] text-white/80">
            The emergency department never closes and needs no appointment. If you can,
            call ahead so the team is ready when you arrive.
          </Reveal>
        </div>

        <Reveal delay={0.16} y={14}>
          <a
            href={`tel:${emergency}`}
            className="group inline-flex items-center gap-3 rounded-full bg-white py-1.5 pl-1.5 pr-5 text-[var(--alert-deep)] transition-transform duration-500 hover:-translate-y-0.5"
          >
            <span className="grid h-10 w-10 place-items-center rounded-full bg-[var(--alert)] text-white">
              <Phone className="h-4 w-4" />
            </span>
            <span className="text-[15px] font-medium tabular-nums">{HOSPITAL.emergency}</span>
          </a>
        </Reveal>
      </div>
    </section>
  );
}

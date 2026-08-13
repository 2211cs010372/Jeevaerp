import { Phone } from "@/components/ui/hugeicons";
import { HOSPITAL } from "@/lib/data";
import { Reveal, SplitLead } from "./motion";

/**
 * The one loud thing on the page, and it is for emergencies only.
 *
 * Full-bleed alert red - a colour that appears nowhere else on this site
 * except the emergency line in the header and the hero. Its whole value is
 * that it is unique: the moment red gets used for a promotion, it stops
 * meaning "this is the one that matters".
 *
 * The instruction leads, not the branding. Somebody scanning this band in a
 * panic needs "don't book, come in" before they need a phone number, and the
 * number needs to be a tap target rather than a piece of typography.
 */
export function EmergencyBand() {
  const emergency = HOSPITAL.emergency.replace(/\s/g, "");

  return (
    <section
      aria-labelledby="emergency-heading"
      className="relative isolate overflow-hidden bg-[var(--alert)] py-16 text-white sm:py-20 lg:py-24"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(120%_90%_at_15%_0%,rgba(255,255,255,0.14),transparent_60%)]"
      />

      <div className="shell-w">
        <div className="rule-row rule-row-dark">
          <span className="rule-idx !text-white/70">(24×7)</span>
          <span className="rule-line !bg-white/25" />
          <span className="rule-label !text-white/70">Emergency</span>
        </div>

        <div className="mt-11 grid gap-10 sm:mt-14 lg:grid-cols-12 lg:items-end">
          <div className="lg:col-span-7">
            <SplitLead
              as="h2"
              id="emergency-heading"
              className="display-lead text-white"
              lines={[{ text: "Don't book." }, { text: "Come straight in." }]}
            />
            <Reveal as="p" delay={0.1} y={18} className="lede mt-7 text-white/80">
              The emergency department never closes and needs no appointment. If
              you can, call ahead so the team is ready before you arrive.
            </Reveal>
          </div>

          <Reveal className="lg:col-span-5 lg:justify-self-end" delay={0.18} y={22}>
            <a
              href={`tel:${emergency}`}
              className="group flex items-center gap-5 rounded-full bg-white py-3 pl-3 pr-8 transition-transform duration-500 hover:-translate-y-1"
            >
              <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-[var(--alert)] text-white transition-transform duration-500 group-hover:scale-105">
                <Phone className="h-5 w-5" />
              </span>
              <span className="min-w-0">
                <span className="mono block text-[9.5px] uppercase tracking-[0.2em] text-[var(--alert)]/70">
                  Call now · any hour
                </span>
                <span className="mono mt-1 block text-[clamp(1.15rem,2.2vw,1.6rem)] font-semibold tabular leading-none text-[var(--alert-deep)]">
                  {HOSPITAL.emergency}
                </span>
              </span>
            </a>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

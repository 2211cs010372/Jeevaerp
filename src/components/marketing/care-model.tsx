import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { CARE_MODEL, HOSPITAL } from "@/lib/data";
import { Chapter } from "./section";
import { Reveal, ScrubText, SplitLead, Stagger } from "./motion";

/**
 * Chapter 03 - the first dark room.
 *
 * The page changes material here. This is the section that says what the
 * hospital actually believes, so it gets the whole viewport width in pine and
 * the one scrub-linked paragraph on the site: the sentence lights up word by
 * word as you scroll through it, which slows a reader down to roughly the
 * speed the sentence deserves.
 *
 * Used exactly once. A second scrubbed paragraph would turn a device into a
 * mannerism.
 */
export function CareModel() {
  return (
    <Chapter id="care" tone="dark">
      <div className="rule-row rule-row-dark">
        <span className="rule-idx">(03)</span>
        <span className="rule-line" />
        <span className="rule-label">The care model</span>
      </div>

      <div className="mt-12 sm:mt-16">
        <SplitLead
          as="h2"
          className="display-lead max-w-4xl text-white"
          lines={[{ text: "You should not have to be" }, { text: "your own medical record." }]}
        />

        <ScrubText
          className="mt-10 max-w-4xl text-[clamp(1.05rem,1.9vw,1.65rem)] font-medium leading-[1.5] tracking-[-0.02em] text-white sm:mt-14"
          text="Most of what goes wrong in a hospital goes wrong in the gaps: a file that did not follow you from one department to the next, a test repeated because nobody could find the first result, a bill nobody could explain. We built the software this hospital runs on before we built this page, and we built it to close those gaps."
        />
      </div>

      {/* the three pillars, ruled */}
      <Stagger each={0.12} y={26} className="grid-lines grid-lines-dark mt-16 sm:mt-20">
        {CARE_MODEL.map((c) => (
          <article key={c.index} className="grid gap-5 py-9 lg:grid-cols-12 lg:gap-10">
            <p className="mono text-[11px] uppercase tracking-[0.2em] text-[var(--teal-tint)] lg:col-span-2">
              ({c.index})
            </p>
            <h3 className="display-sm text-white lg:col-span-4">{c.title}</h3>
            <p className="max-w-[62ch] text-[14.5px] leading-[1.7] text-white/65 lg:col-span-6">
              {c.text}
            </p>
          </article>
        ))}
      </Stagger>

      <Reveal className="mt-12 flex flex-wrap items-center gap-x-8 gap-y-4" y={16}>
        <Link href="/book" className="link-arrow link-arrow-dark">
          Register and book
          <span className="link-arrow-dot">
            <ArrowUpRight className="h-3.5 w-3.5" />
          </span>
        </Link>
        <p className="mono text-[10.5px] uppercase tracking-[0.16em] text-white/40">
          OPD {HOSPITAL.opdHours} · seven days · emergency never closes
        </p>
      </Reveal>
    </Chapter>
  );
}

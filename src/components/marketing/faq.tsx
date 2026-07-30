import { HOSPITAL, FAQ } from "@/lib/data";
import { Chapter, ChapterHead } from "./section";
import { Stagger } from "./motion";

/**
 * Chapter 10 - the questions the front desk answers fifty times a day.
 *
 * Native <details>, so it works before hydration and a browser's in-page find
 * can still open a closed answer. The accordions are ruled rather than carded:
 * ten rounded boxes stacked vertically is a list pretending to be a layout.
 */
export function Faq() {
  return (
    <Chapter id="faq" tone="light">
      <ChapterHead
        index="10"
        label="Questions"
        lines={[{ text: "Before" }, { text: "you come." }]}
        lede="If your question isn't here, call the front desk. A person picks up."
        action={{ href: `tel:${HOSPITAL.phone.replace(/\s/g, "")}`, label: HOSPITAL.phone }}
      />

      <Stagger
        each={0.06}
        y={18}
        className="grid-lines mt-14 sm:mt-18"
      >
        {FAQ.map((f, i) => (
          <details key={f.q} className="group">
            <summary className="flex cursor-pointer list-none items-center gap-5 py-6 sm:gap-8">
              <span className="mono shrink-0 text-[10.5px] text-[var(--muted)] transition-colors group-open:text-[var(--teal)]">
                ({String(i + 1).padStart(2, "0")})
              </span>
              <h3 className="flex-1 text-[16px] font-semibold tracking-[-0.02em] text-[var(--ink)] transition-colors group-open:text-[var(--teal-deep)] sm:text-[17.5px]">
                {f.q}
              </h3>
              <span className="faq-chev" aria-hidden>
                <span className="text-[14px] leading-none">+</span>
              </span>
            </summary>
            <div className="faq-body pb-8">
              <p className="max-w-[72ch] text-[14.5px] leading-[1.8] text-[var(--ink-soft)] sm:pl-[76px]">
                {f.a}
              </p>
            </div>
          </details>
        ))}
      </Stagger>
    </Chapter>
  );
}

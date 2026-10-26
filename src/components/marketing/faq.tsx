import { HOSPITAL, FAQ } from "@/lib/data";
import { Stagger } from "./motion";
import { PosterIntro, POSTER_SECTION } from "./poster-intro";

/**
 * Chapter 08 - the questions people ask before they come.
 *
 * Six, not eleven. The homepage keeps the ones that decide whether somebody
 * comes in at all - what to bring, choosing a doctor, Sundays, paying, reports,
 * languages - and leaves the rest to the desk, whose number is the button
 * above. A long accordion at the end of a page reads as small print.
 *
 * Questions are hairline rows in the serif, the toggle at the far right, the
 * list set in from the left edge under the intro's columns. Still native
 * <details>, so it works before hydration and in-page find can open a closed
 * answer.
 */
const ON_HOME = [
  "What should I bring on my first visit?",
  "Can I choose which doctor I see?",
  "Are you open on Sunday?",
  "Do I pay before or after seeing the doctor?",
  "How do I collect my lab reports?",
  "Which languages can I be seen in?",
];

export function Faq() {
  const items = ON_HOME.map((q) => FAQ.find((f) => f.q === q)).filter((f) => f !== undefined);

  return (
    <section id="faq" className={POSTER_SECTION}>
      <PosterIntro
        index="08"
        label="Questions"
        aside={["Asked at the desk", "fifty times a day."]}
        lede="If your question isn't here, call the front desk - a person picks up."
        action={{ href: `tel:${HOSPITAL.phone.replace(/\s/g, "")}`, label: HOSPITAL.phone }}
        lines={[{ text: "Before" }, { text: "you come.", className: "italic text-[var(--teal)]" }]}
      />

      <div className="mt-[clamp(2rem,4vw,3rem)] grid md:grid-cols-12">
        <Stagger each={0.05} y={14} className="border-b border-[var(--line-strong)] md:col-span-9 md:col-start-4">
          {items.map((f) => (
            <details key={f.q} className="group border-t border-[var(--line-strong)]">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-4">
                <h3 className="f-serif text-[clamp(1.2rem,1.8vw,1.5rem)] leading-[1.1] tracking-[-0.01em] text-[var(--ink)] transition-colors group-open:text-[var(--teal)]">
                  {f.q}
                </h3>
                <span className="faq-chev shrink-0" aria-hidden>
                  <span className="text-[14px] leading-none">+</span>
                </span>
              </summary>
              <div className="faq-body pb-5">
                <p className="max-w-[62ch] pr-10 text-[13.5px] font-medium leading-[1.45] text-[var(--ink-soft)]">{f.a}</p>
              </div>
            </details>
          ))}
        </Stagger>
      </div>
    </section>
  );
}

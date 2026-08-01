import { HOSPITAL, FAQ } from "@/lib/data";
import { Chapter, ChapterHead } from "./section";
import { Stagger } from "./motion";

/**
 * Chapter 10 - the questions the front desk answers fifty times a day.
 *
 * Two columns, the way the reference site builds its FAQ: the ask and a way to
 * reach a person on the left, the accordion on the right. Splitting them is
 * what stops a long list of questions reading as the end of the page - the
 * phone number stays beside the questions instead of scrolling away above them.
 *
 * Items are hairline-ruled rows rather than rounded boxes, with the question on
 * the left and the toggle pushed to the far right. Ten rounded boxes stacked
 * vertically is a list pretending to be a layout.
 *
 * Still native <details>, so it works before hydration and a browser's in-page
 * find can still open a closed answer.
 */
export function Faq() {
  return (
    <Chapter id="faq" tone="light">
      <div className="grid gap-10 lg:grid-cols-2 lg:gap-16">
        {/* The left column holds still while the questions scroll past it. The
            reference has five items and does not need this; we have enough that
            the phone number would otherwise be long gone by the last one. */}
        <div className="lg:sticky lg:top-[calc(var(--nav-h)+2.5rem)] lg:self-start">
          <ChapterHead
            index="10"
            label="Questions"
            lines={[{ text: "Before" }, { text: "you come." }]}
            lede="If your question isn't here, call the front desk. A person picks up."
            action={{
              href: `tel:${HOSPITAL.phone.replace(/\s/g, "")}`,
              label: HOSPITAL.phone,
            }}
            align="stack"
            /* the reference sets its FAQ headline at 43px, not at the full
               chapter scale - a display-lead sized for a full-width row leaves
               nothing but headline in a half-width column */
            className="[&_.display-lead]:text-[clamp(2rem,3.4vw,3.1rem)]"
          />
        </div>

        <Stagger each={0.05} y={16} className="grid-lines lg:mt-2">
          {FAQ.map((f) => (
            <details key={f.q} className="group">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-5">
                <h3 className="text-[15px] font-semibold leading-snug tracking-[-0.02em] text-[var(--ink)] transition-colors group-open:text-[var(--teal-deep)] sm:text-[16px]">
                  {f.q}
                </h3>
                <span className="faq-chev shrink-0" aria-hidden>
                  <span className="text-[14px] leading-none">+</span>
                </span>
              </summary>

              <div className="faq-body pb-6">
                <p className="max-w-[62ch] pr-10 text-[14px] leading-[1.75] text-[var(--ink-soft)]">
                  {f.a}
                </p>
              </div>
            </details>
          ))}
        </Stagger>
      </div>
    </Chapter>
  );
}

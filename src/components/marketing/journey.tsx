import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { JOURNEY } from "@/lib/data";
import { Chapter, ChapterHead } from "./section";
import { Reveal, Stagger } from "./motion";

/**
 * Chapter 05 - a first visit, in order.
 *
 * Four steps on a single hairline, numbered in mono. The rule running across
 * the top of the row is the visual promise that these happen in sequence and
 * that there are only four of them - which is the actual reassurance somebody
 * needs before their first appointment.
 */
export function Journey() {
  return (
    <Chapter tone="light">
      <ChapterHead
        index="05"
        label="Your first visit"
        lines={[{ text: "Four steps," }, { text: "start to finish." }]}
        lede="Registration takes about two minutes and happens once. After that, your Jeeva ID is the only thing you need to bring."
        action={{ href: "/book", label: "Start with step 01" }}
      />

      <Stagger
        as="ol"
        each={0.1}
        y={26}
        className="mt-14 grid gap-x-10 border-t border-[var(--line-strong)] sm:mt-18 sm:grid-cols-2 lg:grid-cols-4"
      >
        {JOURNEY.map((j) => (
          <li key={j.step} className="border-b border-[var(--line)] py-8 lg:border-b-0 lg:border-l lg:border-[var(--line)] lg:pl-10 lg:first:border-l-0 lg:first:pl-0">
            <span className="mono text-[11px] uppercase tracking-[0.2em] text-[var(--teal)]">
              ({j.step})
            </span>
            <h3 className="display-sm mt-5 text-[var(--ink)]">{j.title}</h3>
            <p className="mt-3 text-[13.5px] leading-[1.7] text-[var(--ink-soft)]">{j.text}</p>
          </li>
        ))}
      </Stagger>

      <Reveal className="mt-10" y={14}>
        <Link href="/book" className="link-arrow">
          Book your first appointment
          <span className="link-arrow-dot">
            <ArrowUpRight className="h-3.5 w-3.5" />
          </span>
        </Link>
      </Reveal>
    </Chapter>
  );
}

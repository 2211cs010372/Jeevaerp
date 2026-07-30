import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { WARDS } from "@/lib/data";
import { Chapter } from "./section";
import { Reveal, SplitLead, Stagger } from "./motion";

/**
 * Chapter 07 - the second dark room: what it costs.
 *
 * Most hospital sites hide their rates, and families find out at the billing
 * counter on the worst day of their week. These are the same figures the ERP
 * charges from and locks at admission, so this page and the discharge bill
 * cannot disagree.
 *
 * Set as an editorial table rather than four pricing cards, because a table is
 * what somebody comparing four rooms actually wants: one column of prices,
 * readable top to bottom, in tabular figures that line up.
 */
export function Wards() {
  return (
    <Chapter id="wards" tone="dark">
      <div className="rule-row rule-row-dark">
        <span className="rule-idx">(07)</span>
        <span className="rule-line" />
        <span className="rule-label">Rooms &amp; prices</span>
      </div>

      <div className="mt-11 grid gap-x-12 gap-y-7 sm:mt-14 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:items-end">
        <SplitLead
          as="h2"
          className="display-lead text-white"
          lines={[{ text: "No surprises" }, { text: "at the bill." }]}
        />
        <Reveal as="p" delay={0.08} y={18} className="lede text-white/65 lg:pb-2">
          These are the rates our billing system charges from, frozen the moment
          you are admitted. Room rent above ₹5,000 a day attracts 5% GST; ICU is
          exempt.
        </Reveal>
      </div>

      {/* the table */}
      <Stagger each={0.09} y={22} className="grid-lines grid-lines-dark mt-14 sm:mt-18">
        {WARDS.map((w) => (
          <article
            key={w.name}
            className="grid items-start gap-x-10 gap-y-4 py-8 lg:grid-cols-12"
          >
            <div className="lg:col-span-3">
              <h3 className="display-sm text-white">{w.name}</h3>
              <p className="mono mt-2 text-[10px] uppercase tracking-[0.16em] text-white/40">
                {w.floor} · {w.beds} beds
              </p>
            </div>

            <div className="lg:col-span-3">
              <p className="mono text-[clamp(1.5rem,2.4vw,2.1rem)] font-semibold tabular leading-none text-white">
                ₹{w.price.toLocaleString("en-IN")}
                <span className="text-[13px] font-normal text-white/45"> /day</span>
              </p>
              <p className="mono mt-2 text-[10.5px] uppercase tracking-[0.14em] text-[var(--teal-tint)]">
                {w.gst > 0 ? `+ ${w.gst}% GST` : "No GST"}
              </p>
            </div>

            <p className="text-[14px] leading-[1.65] text-white/65 lg:col-span-3">{w.note}</p>

            <ul className="flex flex-wrap gap-2 lg:col-span-3 lg:justify-end">
              {w.includes.map((inc) => (
                <li key={inc} className="chip chip-dark !py-1.5 !text-[10.5px]">
                  {inc}
                </li>
              ))}
            </ul>
          </article>
        ))}
      </Stagger>

      {/* the money-honesty strip - the three questions families ask at the counter */}
      <Stagger each={0.09} y={20} className="mt-14 grid gap-4 sm:mt-16 md:grid-cols-3">
        {ASSURANCES.map((a) => (
          <div key={a.title} className="card-dark p-6">
            <span className="grid h-10 w-10 place-items-center rounded-full bg-white/10 text-[var(--teal-tint)]">
              <svg width="19" height="19" viewBox="0 0 24 24" aria-hidden>
                {a.icon}
              </svg>
            </span>
            <h3 className="mt-5 text-[14.5px] font-semibold tracking-[-0.015em] text-white">
              {a.title}
            </h3>
            <p className="mt-2 text-[13px] leading-[1.65] text-white/60">{a.text}</p>
          </div>
        ))}
      </Stagger>

      <Reveal className="mt-12" y={14}>
        <Link href="/health-checks" className="link-arrow link-arrow-dark">
          Health check packages and prices
          <span className="link-arrow-dot">
            <ArrowUpRight className="h-3.5 w-3.5" />
          </span>
        </Link>
      </Reveal>
    </Chapter>
  );
}

const stroke = {
  fill: "none" as const,
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const ASSURANCES = [
  {
    title: "Pay how you like",
    text: "Cash, UPI and cards at every counter - consultation, lab, pharmacy and admissions.",
    icon: (
      <g {...stroke}>
        <rect x="2.5" y="6" width="19" height="13" rx="2.5" />
        <path d="M2.5 10h19M6.5 15h4" />
      </g>
    ),
  },
  {
    title: "A receipt for everything",
    text: "Every payment gets a printed, GST-compliant receipt, and any past bill can be reprinted at the desk.",
    icon: (
      <g {...stroke}>
        <path d="M6 2.5h12v19l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4-2 1.4v-19Z" />
        <path d="M9 8h6M9 12h6M9 16h3.5" />
      </g>
    ),
  },
  {
    title: "Rates locked at admission",
    text: "Ward prices are published here and frozen when you are admitted - the bill cannot disagree with the website.",
    icon: (
      <g {...stroke}>
        <rect x="4.5" y="10" width="15" height="11" rx="2.5" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3M12 14.5v3" />
      </g>
    ),
  },
];

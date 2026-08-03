import Link from "next/link";
import { ArrowUpRight, Phone } from "lucide-react";
import { CARE_MODEL, HOSPITAL } from "@/lib/data";
import { Chapter } from "./section";
import { Reveal, ScrubText, SplitLead, Stagger } from "./motion";

/**
 * Chapter 03 - what the hospital actually believes, as a bento.
 *
 * REBUILT FROM RULED ROWS TO CARDS. Six hairline-separated rows is the right
 * shape for a list you scan and the wrong one for six claims you are meant to
 * weigh: every row got identical visual weight, so the promise that matters
 * most - the emergency door - arrived last and quietest. Cards let the grid say
 * which of these is the big one, and a card is also the idiom the rest of this
 * site is built from, so the chapter stops being the odd one out.
 *
 * THE PALETTE IS "WHY JEEVA'S", DELIBERATELY. White cells on porcelain, 16px
 * corners, no borders and no shadows, counted teal numerals, and the accent
 * spent in exactly one filled cell. A visitor has already learnt to read that
 * shape two chapters ago; reusing it here means the care model reads as more of
 * the same argument rather than as a different page.
 *
 * THE PINE ROOM SURVIVES AS A CARD. This was the site's one full-bleed dark
 * band, and losing it entirely would flatten the contrast rhythm the homepage
 * is built on - so the manifesto keeps its pine, as a panel at the head of the
 * chapter, and the six pillars come out into the light beneath it. That also
 * keeps the site's ONE scrub-linked paragraph exactly where it was: the
 * sentence still lights up word by word, still only happens once.
 *
 * IT STAYS A BENTO ON A PHONE, the same way "Why Jeeva" does. Two columns from
 * 320px up: the four claims that carry an argument run the full width, and
 * (02) and (03) pair off beside each other as tiles. Six identical full-width
 * cards is a list, and a list is exactly the shape this chapter was rebuilt
 * out of - a phone should get the composed version too, not the fallback.
 */

/** How much of the row each claim is worth. The two widest are the two a
 *  family actually chooses a hospital on: the record, and the open door.
 *
 *  The `max-sm` half is the phone composition - see the note about tiles
 *  above. The same three claims stay big there; the difference is that on two
 *  columns "big" means the full width rather than two thirds of the row. */
const SPAN: Record<string, string> = {
  "01": "max-sm:col-span-2 lg:col-span-2",
  "04": "max-sm:col-span-2 lg:col-span-2",
  "05": "max-sm:col-span-2",
  "06": "max-sm:col-span-2 lg:col-span-2",
};

/**
 * The two claims that pair off as square tiles on a phone.
 *
 * Both are already narrow cells at `lg`, so the hierarchy the grid states on a
 * desktop survives the reflow - what changes is that a tile drops its
 * supporting paragraph below `sm`, where 13.5px prose in a 100px column runs
 * to twelve ragged lines. Neither paragraph is lost from the page: (02) says
 * what the pine panel directly above it already says, and both restate steps
 * of the visit chapter almost word for word.
 */
const MOBILE_TILE = new Set(["02", "03"]);

export function CareModel() {
  const emergency = HOSPITAL.emergency.replace(/\s/g, "");

  return (
    <Chapter id="care" tone="light">
      <div className="rule-row">
        <span className="rule-idx">(03)</span>
        <span className="rule-line" />
        <span className="rule-label">The care model</span>
      </div>

      {/* ── the manifesto, still in pine ─────────────────────────────────── */}
      <Reveal
        className="relative isolate mt-9 overflow-hidden rounded-xl bg-[var(--pine-ink)] px-6 py-14 text-white sm:mt-12 sm:px-12 sm:py-20"
        y={26}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(120%_90%_at_15%_-10%,rgba(23,112,95,0.34),transparent_62%),radial-gradient(90%_70%_at_90%_110%,rgba(11,84,76,0.34),transparent_60%)]"
        />

        <SplitLead
          as="h2"
          className="display-lead max-w-4xl text-white"
          lines={[{ text: "You should not have to be" }, { text: "your own medical record." }]}
        />

        <ScrubText
          className="mt-10 max-w-4xl text-[clamp(1.05rem,1.9vw,1.65rem)] font-medium leading-[1.5] tracking-[-0.02em] text-white sm:mt-14"
          text="Most of what goes wrong in a hospital goes wrong in the gaps: a file that did not follow you from one department to the next, a test repeated because nobody could find the first result, a bill nobody could explain. We built the software this hospital runs on before we built this page, and we built it to close those gaps."
        />
      </Reveal>

      {/* ── the six pillars, as cells ────────────────────────────────────── */}
      <Stagger each={0.07} y={24} className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-3">
        {CARE_MODEL.map((c) => {
          const tile = MOBILE_TILE.has(c.index);

          return c.index === "06" ? (
            /* the one filled cell - the only place the accent is spent, and it
               goes to the promise that has to survive being read in a panic */
            <article
              key={c.index}
              className={`flex flex-col justify-between rounded-[16px] bg-[var(--teal)] p-5 sm:p-7 ${SPAN[c.index] ?? ""}`}
            >
              <p className="mono text-[10px] uppercase tracking-[0.18em] text-white/55">
                ({c.index}) · Always open
              </p>
              <div className="mt-8 sm:mt-10">
                <h3 className="display-sm max-w-[24ch] text-white">{c.title}</h3>
                <p className="mt-3.5 max-w-[62ch] text-[13.5px] leading-[1.7] text-white/75">
                  {c.text}
                </p>
                <a
                  href={`tel:${emergency}`}
                  className="mono mt-7 inline-flex items-center gap-2.5 rounded-full bg-white/10 px-4 py-2.5 text-[12px] tracking-[0.04em] text-white transition-colors hover:bg-white/20"
                >
                  <Phone className="h-3.5 w-3.5" /> {HOSPITAL.emergency} · 24×7
                </a>
              </div>
            </article>
          ) : (
            <article
              key={c.index}
              className={`flex flex-col justify-between rounded-[16px] bg-[var(--paper)] sm:p-7 ${
                tile ? "max-sm:p-4" : "max-sm:p-5"
              } ${SPAN[c.index] ?? ""}`}
            >
              <p className="mono text-[10px] uppercase tracking-[0.18em] text-[var(--teal)]">
                ({c.index})
              </p>
              <div className={tile ? "mt-6 sm:mt-10" : "mt-8 sm:mt-10"}>
                {/* a tile's title steps down a size on a phone - "Diagnostics"
                    set at display-sm is wider than the column it has to sit in */}
                <h3
                  className={`display-sm max-w-[24ch] text-[var(--ink)] ${
                    tile ? "max-sm:text-[1rem] max-sm:leading-[1.2]" : ""
                  }`}
                >
                  {c.title}
                </h3>
                <p
                  className={`mt-3.5 max-w-[62ch] text-[13.5px] leading-[1.7] text-[var(--ink-soft)] ${
                    tile ? "max-sm:hidden" : ""
                  }`}
                >
                  {c.text}
                </p>
              </div>
            </article>
          );
        })}
      </Stagger>

      <Reveal className="mt-10 flex flex-wrap items-center gap-x-8 gap-y-4" y={16}>
        <Link href="/book" className="link-arrow">
          Register and book
          <span className="link-arrow-dot">
            <ArrowUpRight className="h-3.5 w-3.5" />
          </span>
        </Link>
        {/* read from HOSPITAL rather than typed: this line used to claim
            "seven days" while the data said Monday to Saturday, so the site
            contradicted its own opening hours two chapters apart */}
        <p className="mono text-[10.5px] uppercase tracking-[0.16em] text-[var(--muted)]">
          OPD {HOSPITAL.opdHours} · {HOSPITAL.opdDays} · emergency never closes
        </p>
      </Reveal>
    </Chapter>
  );
}

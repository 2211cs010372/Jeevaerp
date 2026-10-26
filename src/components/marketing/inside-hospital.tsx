import Image from "next/image";
import { DEPARTMENTS, WARDS } from "@/lib/data";
import { Counter, Stagger } from "./motion";
import { PosterIntro, POSTER_SECTION } from "./poster-intro";

/**
 * Chapter 05 - inside the hospital.
 *
 * Folds two old chapters into one: the facilities bento and the numbers band.
 * Four figures on hairline rules first - what the building holds - then four
 * portrait cards for the rooms most visits pass through: the lab, imaging,
 * the pharmacy and the day theatre.
 *
 * The figures are counts the ERP can prove (beds and ICU beds from WARDS, the
 * routine-report turnaround, the emergency door). No prices - nothing on the
 * public site shows one.
 *
 * The photographs are licensed stock (Unsplash, 3840px masters in
 * /public/images/facilities), chosen to show the room and the equipment, never
 * a face, and captioned as what the room does rather than as "our lab".
 */
const ROOMS = [
  {
    title: "Diagnostics lab",
    text: "Routine bloods processed in-house - on your record, and your phone, usually before you leave.",
    img: "/images/facilities/lab.jpg",
    alt: "Rows of labelled blood sample tubes in a rack",
  },
  {
    title: "Imaging",
    text: "Digital X-ray for fractures and spine, and scans arranged without a trip across town.",
    img: "/images/facilities/imaging.jpg",
    alt: "A scanner in a clean, bright imaging room",
  },
  {
    title: "Pharmacy",
    text: "Batch-tracked stock dispensed against your Jeeva ID, with a printed GST bill.",
    img: "/images/facilities/pharmacy.jpg",
    alt: "Medicine bottles on a pharmacy shelf",
  },
  {
    title: "Day theatre",
    text: "Minor procedures and day surgery, with recovery in the same building.",
    img: "/images/facilities/theatre.jpg",
    alt: "An empty operating theatre with its lights and equipment",
  },
];

export function InsideHospital() {
  const beds = WARDS.reduce((s, w) => s + w.beds, 0);
  const icu = WARDS.find((w) => w.name === "ICU")?.beds ?? 0;

  const figures = [
    { value: beds, suffix: "", label: "Inpatient beds", note: "General, semi-private, private" },
    { value: icu, suffix: "", label: "ICU beds", note: "Continuously monitored" },
    { value: DEPARTMENTS.length, suffix: "", label: "Specialities", note: "Under one roof" },
    { value: 24, suffix: "×7", label: "Emergency", note: "The door never closes" },
  ];

  return (
    <section id="facilities" className={POSTER_SECTION}>
      <PosterIntro
        index="05"
        label="Inside the hospital"
        aside={["The test, the scan,", "the medicine -", "a corridor away."]}
        lede="The point of a multispeciality building is that everything a visit needs is inside it, not another trip across town."
        action={{ href: "/#visit", label: "Plan your visit" }}
        lines={[{ text: "Everything under" }, { text: "one roof.", className: "italic text-[var(--teal)]" }]}
      />

      {/* what the building holds */}
      <Stagger each={0.06} y={14} className="mt-[clamp(2rem,4vw,3rem)] grid grid-cols-2 gap-x-6 gap-y-8 md:grid-cols-4">
        {figures.map((f) => (
          <div key={f.label} className="border-t border-[var(--line-strong)] pt-4">
            <p className="text-[12px] font-medium text-[var(--muted)]">{f.label}</p>
            <p className="f-serif mt-4 text-[clamp(2.4rem,3.8vw,3.6rem)] leading-[0.9] tracking-[-0.02em] text-[var(--ink)]">
              <Counter value={f.value} suffix={f.suffix} />
            </p>
            <p className="mt-2 text-[12.5px] font-medium text-[var(--ink-soft)]">{f.note}</p>
          </div>
        ))}
      </Stagger>

      {/* the rooms */}
      <Stagger
        each={0.07}
        y={20}
        className="mx-auto mt-[clamp(2.5rem,5vw,4rem)] grid max-w-[600px] grid-cols-2 gap-2 lg:max-w-[1180px] lg:grid-cols-4"
      >
        {ROOMS.map((r) => (
          <article key={r.title} className="flex aspect-[4/5] flex-col rounded-[12px] bg-[var(--bone)] p-1.5">
            <div className="relative min-h-0 flex-1 overflow-hidden rounded-[8px]">
              <Image src={r.img} alt={r.alt} fill sizes="(min-width: 1024px) 290px, 45vw" className="object-cover" />
            </div>
            <div className="px-1.5 pb-1 pt-2.5 sm:px-2">
              <h3 className="f-serif text-[clamp(1.15rem,1.7vw,1.5rem)] leading-[1.05] tracking-[-0.01em] text-[var(--ink)]">
                {r.title}
              </h3>
              <p className="mt-1 line-clamp-2 text-[11.5px] font-medium leading-[1.25] text-[var(--ink-soft)] max-sm:hidden">
                {r.text}
              </p>
            </div>
          </article>
        ))}
      </Stagger>
    </section>
  );
}

import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { SmartImage } from "@/components/ui/smart-image";
import { DoctorAvatar } from "@/components/marketing/doctor-avatar";
import { DEPARTMENTS, DOCTORS, HOSPITAL } from "@/lib/data";
import { Chapter, ChapterHead } from "./section";
import { Counter, Parallax, Reveal, Stagger } from "./motion";

/**
 * Chapter 01 - the opening claim.
 *
 * One photograph and three numbers. The numbers are all things the ERP behind
 * this site can actually prove: how many departments are staffed, how many
 * consultants sit in them, and how fast the lab turns routine bloods around.
 * Nothing here is a round number chosen because it looked confident.
 */
export function Trust() {
  const faces = DOCTORS.slice(0, 4);
  const rest = Math.max(0, DOCTORS.length - faces.length);

  const PROOF = [
    {
      value: DEPARTMENTS.length,
      suffix: "",
      label: "Departments, staffed",
      text: "Medicine, surgery, women's and children's health and more, consulting under one roof - so most families never leave the building for a referral.",
    },
    {
      value: DOCTORS.length,
      suffix: "+",
      label: "Consultants on the panel",
      text: "Named doctors with published fees, days and OPD hours. You know who you are seeing before you book.",
    },
    {
      value: 30,
      suffix: " min",
      label: "Routine report turnaround",
      text: "Bloods drawn in the morning are usually on your record - and your phone - before you have left.",
    },
  ];

  return (
    <Chapter id="why" tone="light">
      <ChapterHead
        index="01"
        label="Why Jeeva"
        lines={[{ text: "Care that" }, { text: "remembers you." }]}
        lede="A hospital that already knows your history is a hospital that stops asking you to be your own medical record. That is the whole idea, and everything below is what it takes to keep the promise."
        action={{ href: "/doctors", label: "Meet the consultants" }}
      />

      <div className="mt-14 grid gap-8 sm:mt-18 lg:grid-cols-12 lg:gap-10">
        {/* the building, held still while the page moves past it */}
        <Reveal className="lg:col-span-7" y={34}>
          <figure className="media-frame relative aspect-[16/11] overflow-hidden rounded-[var(--r-xl)] sm:aspect-[16/10]">
            <Parallax amount={10} className="absolute inset-0 h-[112%] -top-[6%]">
              <SmartImage
                src="/images/hospital_banner.jpeg"
                alt={`Inside ${HOSPITAL.name}`}
                label="Hospital interior"
                className="h-full w-full object-cover"
              />
            </Parallax>

            <figcaption className="absolute inset-x-0 bottom-0 z-10 flex flex-wrap items-end justify-between gap-4 p-6 sm:p-8">
              <div>
                <p className="mono text-[10px] uppercase tracking-[0.2em] text-white/65">
                  {HOSPITAL.locality}
                </p>
                <p className="display-sm mt-2 max-w-xs text-white">
                  One building. One record. One ID for life.
                </p>
              </div>

              {/* who is actually in the building today */}
              <div className="flex items-center gap-3">
                <span className="flex -space-x-2.5">
                  {faces.map((d) => (
                    <DoctorAvatar
                      key={d.id}
                      name={d.name}
                      image={d.image}
                      className="h-9 w-9 rounded-full border-2 border-white/85 text-[9px]"
                    />
                  ))}
                  {rest > 0 && (
                    <span className="grid h-9 w-9 place-items-center rounded-full border-2 border-white/85 bg-[var(--teal)] text-[10px] font-semibold text-white">
                      +{rest}
                    </span>
                  )}
                </span>
              </div>
            </figcaption>
          </figure>
        </Reveal>

        {/* the three claims, ruled like a table of contents */}
        <Stagger each={0.1} y={24} className="grid-lines lg:col-span-5">
          {PROOF.map((p) => (
            <div key={p.label} className="flex gap-6 py-7 first:pt-8 sm:gap-8">
              <p className="stat-num shrink-0 text-[var(--teal)] [font-size:clamp(2.1rem,3.4vw,3rem)]">
                <Counter value={p.value} suffix={p.suffix} />
              </p>
              <div className="min-w-0 pt-1.5">
                <h3 className="text-[15px] font-semibold tracking-[-0.015em] text-[var(--ink)]">
                  {p.label}
                </h3>
                <p className="mt-2 text-[13.5px] leading-[1.65] text-[var(--ink-soft)]">
                  {p.text}
                </p>
              </div>
            </div>
          ))}

          <Reveal className="pt-7" y={16}>
            <Link href="/book" className="link-arrow">
              Book a consultation
              <span className="link-arrow-dot">
                <ArrowUpRight className="h-3.5 w-3.5" />
              </span>
            </Link>
          </Reveal>
        </Stagger>
      </div>
    </Chapter>
  );
}

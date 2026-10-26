import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight } from "@/components/ui/hugeicons";
import { CARE_AREAS } from "@/lib/data";
import { careHref } from "@/lib/care";
import { specialityImage } from "@/lib/speciality-images";
import { Stagger } from "./motion";
import { PosterIntro, POSTER_SECTION } from "./poster-intro";

/**
 * Chapter 03 - the specialities, as six portrait posters.
 *
 * Organised by care area rather than by clinical department, for the reason
 * the navbar is: nobody searches for "Orthopaedics", they search for a bone
 * doctor, or they only know something is wrong with their child. Each card is
 * the area's photograph at 4:5 with its name set over the foot of the picture
 * - which is exactly the shape of an Instagram portrait post, so each one can
 * be posted as it stands.
 *
 * The photographs are the speciality images the doctor cards use (see
 * lib/speciality-images.ts) - pictures of the work, never a face. The card
 * opens the area's first department page, which lists the rest.
 *
 * Card size matches the first-visit chapter's, so the posters read as one
 * series: two across in a 600px track on a portrait iPad (~296px), three
 * across in an 840px track from lg up (~275px).
 *
 * Replaces the pinned horizontal rail (why-choose.tsx), which ran sixteen
 * department cards past a scroll-jacked viewport: cinematic on a desktop,
 * and on an iPad a strip nobody could screenshot whole.
 */
const PICTURE: Record<string, string> = {
  "Child Care": "Paediatrics",
  "Women Care": "Gynaecology",
  "Surgical Care": "General Surgery",
  "Ortho & Rehab": "Orthopaedics",
  "Neuro Care": "Neurology",
  "More Care": "General Medicine",
};

export function Specialities() {
  return (
    <section id="specialities" className={POSTER_SECTION}>
      <PosterIntro
        index="03"
        label="Specialities"
        aside={["Six doors.", "One building."]}
        lede="People rarely arrive looking for a department. They arrive knowing something hurts, or that a child is unwell. These are the doors the departments sit behind."
        action={{ href: "/doctors", label: "Find your consultant" }}
        lines={[{ text: "Care for every" }, { text: "stage of life.", className: "italic text-[var(--teal)]" }]}
      />

      <Stagger
        each={0.06}
        y={20}
        className="mx-auto mt-[clamp(2rem,4vw,3rem)] grid max-w-[600px] grid-cols-2 gap-2 lg:max-w-[840px] lg:grid-cols-3"
      >
        {CARE_AREAS.map((area, i) => (
          <Link
            key={area.label}
            href={careHref(area.departments[0])}
            className="group relative block aspect-[4/5] overflow-hidden rounded-[12px] bg-[var(--bone)]"
          >
            <Image
              src={specialityImage(PICTURE[area.label] ?? area.departments[0])}
              alt=""
              fill
              sizes="(min-width: 1024px) 280px, (min-width: 768px) 300px, 50vw"
              className="object-cover transition-transform duration-700 ease-[var(--ease-out)] group-hover:scale-[1.04]"
            />
            {/* the wash that the type sits on - darkest at the foot only */}
            <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-[rgba(9,22,21,0.82)] via-[rgba(9,22,21,0.18)] to-transparent" />

            <span className="absolute left-2.5 top-2.5 rounded-full bg-white/85 px-2 py-0.5 text-[10.5px] font-medium tabular-nums text-[var(--ink)] backdrop-blur">
              {String(i + 1).padStart(2, "0")}
            </span>
            <span className="absolute right-2.5 top-2.5 grid h-7 w-7 place-items-center rounded-full bg-white/85 text-[var(--ink)] backdrop-blur transition-[transform,background-color,color] duration-400 group-hover:rotate-45 group-hover:bg-[var(--ink)] group-hover:text-white">
              <ArrowUpRight size={13} />
            </span>

            <div className="absolute inset-x-0 bottom-0 p-3 text-white sm:p-4">
              <h3 className="f-serif text-[clamp(1.4rem,2.4vw,2.1rem)] leading-[1] tracking-[-0.01em]">
                {area.label}
              </h3>
              <p className="mt-1.5 line-clamp-2 max-w-[34ch] text-[11.5px] font-medium leading-[1.25] text-white/75 max-sm:hidden">
                {area.blurb}
              </p>
              <p className="mt-2 text-[10.5px] font-medium text-white/60">
                {area.departments.length} {area.departments.length === 1 ? "department" : "departments"}
              </p>
            </div>
          </Link>
        ))}
      </Stagger>
    </section>
  );
}

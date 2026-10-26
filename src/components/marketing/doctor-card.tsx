import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight } from "@/components/ui/hugeicons";
import type { Doctor } from "@/lib/data";
import { doctorHref } from "@/lib/doctors";
import { doctorImage } from "@/lib/speciality-images";

/**
 * The consultant card - one shape on the homepage, the directory and the
 * "other consultants" row under a profile, so a doctor looks the same
 * wherever you meet them.
 *
 * A 4:5 picture over the name, the speciality and the days they consult; 10px
 * corners, laid 8px apart by its parent grid. Not big, not small: about 290px
 * wide four-across on a desktop, ~250-300px on an iPad.
 *
 * THE PICTURE IS THE CONSULTANT'S OWN PHOTO WHEN ONE EXISTS (Doctor.photoUrl,
 * uploaded under Admin -> HR), and their speciality's photograph until then -
 * an ultrasound print for gynaecology, a stethoscope for medicine. Never a
 * stock face: see lib/speciality-images.ts. Without an own photo the card
 * carries the doctor's monogram on the picture, so it is clear the picture is
 * of the work and the monogram is the person.
 *
 * No fee - nothing on the public site shows a price.
 */
export function DoctorCard({ doctor: d }: { doctor: Doctor }) {
  const img = doctorImage(d);

  return (
    <Link
      href={doctorHref(d)}
      className="group f-sans flex h-full flex-col rounded-[10px] bg-[var(--bone)] p-1.5 transition-colors duration-300 hover:bg-[var(--bone-deep)]"
    >
      <div className="relative aspect-[4/5] overflow-hidden rounded-[7px] bg-[var(--bone-deep)]">
        {img.own ? (
          /* An uploaded portrait lives on the storage host, not in /public,
             so a plain <img> rather than next/image and its host allow-list. */
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={img.src}
            alt={d.name}
            loading="lazy"
            className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 ease-[var(--ease-out)] group-hover:scale-[1.04]"
          />
        ) : (
          <Image
            src={img.src}
            alt=""
            fill
            sizes="(min-width: 1024px) 290px, (min-width: 768px) 33vw, 50vw"
            className="object-cover transition-transform duration-700 ease-[var(--ease-out)] group-hover:scale-[1.04]"
          />
        )}

        <span className="absolute left-2 top-2 max-w-[calc(100%-3rem)] truncate rounded-full bg-white/85 px-2 py-0.5 text-[10.5px] font-medium text-[var(--ink)] backdrop-blur">
          {d.department}
        </span>
        <span className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full bg-white/85 text-[var(--ink)] backdrop-blur transition-[transform,background-color,color] duration-400 group-hover:rotate-45 group-hover:bg-[var(--ink)] group-hover:text-white">
          <ArrowUpRight size={13} />
        </span>

        {/* the person, on a picture of the work */}
        {!img.own && (
          <span
            aria-hidden
            className="f-serif absolute bottom-2 left-2 grid h-9 w-9 place-items-center rounded-full bg-white text-[15px] text-[var(--ink)]"
          >
            {initials(d.name)}
          </span>
        )}
      </div>

      <div className="px-1.5 pb-1.5 pt-2.5">
        <h3 className="f-serif truncate text-[clamp(1.15rem,1.6vw,1.4rem)] leading-[1.1] tracking-[-0.01em] text-[var(--ink)]">
          {d.name}
        </h3>
        <p className="mt-0.5 truncate text-[12px] font-medium text-[var(--muted)]">{d.specialization}</p>
        <p className="mt-2 flex items-center justify-between gap-2 border-t border-[var(--line-strong)] pt-2 text-[11.5px] font-medium text-[var(--ink-soft)]">
          <span className="truncate">{d.days}</span>
          {d.experience > 0 && <span className="shrink-0 text-[var(--muted)]">{d.experience} yrs</span>}
        </p>
      </div>
    </Link>
  );
}

/** "Dr. K. Padmaja" -> "KP". Exported for the profile's portrait badge. */
export function initials(name: string) {
  return name
    .replace(/^Dr\.?\s*/i, "")
    .split(/[\s.]+/)
    .map((n) => n[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

import Link from "next/link";
import { DoctorAvatar } from "@/components/marketing/doctor-avatar";
import type { Doctor } from "@/lib/data";
import { doctorHref } from "@/lib/doctors";

/**
 * The consultant card, in the reference site's people-card shape.
 *
 * A portrait at 3:4 filling a 10px-cornered cell, with a white pill floating
 * clear of the bottom edge carrying the name and the department. The reference
 * builds its card the same way: 10px outer, 10px padding, an 8px inner frame,
 * and a 5px pill inset 14px from the sides and foot.
 *
 * THE PORTRAIT IS THE POINT. A directory of consultants is scanned by face
 * before it is read by name - people recognise the doctor they saw last time
 * long before they recall how it was spelled. So the photograph gets the whole
 * cell and the type gets a pill, rather than the other way round.
 *
 * ONE DIFFERENCE FROM THE REFERENCE, DELIBERATELY. Its pill leads with a 44px
 * circular headshot beside the name. Ours does not: the face is already the
 * entire card behind it, and printing the same person twice in one card reads
 * as a mistake. The years-in-practice badge takes that slot instead, up on the
 * portrait where it does not squeeze the name.
 *
 * No fee. Consultation prices are published on the doctor's own profile and in
 * the booking flow, not on the browsing card.
 */
export function DoctorCard({ doctor: d }: { doctor: Doctor }) {
  return (
    <Link
      href={doctorHref(d)}
      className="group block rounded-[10px] bg-[var(--bone)] p-2.5 transition-colors duration-300 hover:bg-[var(--bone-deep)]"
    >
      <div className="zoom-media relative aspect-[3/4] overflow-hidden rounded-[8px] bg-[var(--bone-deep)]">
        <DoctorAvatar
          name={d.name}
          image={d.image}
          className="h-full w-full text-3xl"
        />

        {/* years in practice - kept on the portrait so the pill below can give
            the whole of its width to a name that must not be truncated */}
        <span className="mono absolute left-3 top-3 z-10 rounded-full bg-black/40 px-2.5 py-1 text-[9.5px] uppercase tracking-[0.14em] text-white backdrop-blur">
          {d.experience} yrs
        </span>

        {/* the reference's box_white: 5px corners, 8px of padding, sitting
            clear of the frame rather than flush to it */}
        <div className="absolute inset-x-3 bottom-3 z-10 rounded-[5px] bg-[var(--paper)] p-2">
          <h3 className="text-[12.5px] font-semibold leading-[1.25] tracking-[-0.02em] text-[var(--ink)] sm:text-[13.5px]">
            {d.name}
          </h3>
          <p className="mono mt-0.5 truncate text-[9px] uppercase tracking-[0.12em] text-[var(--muted)] sm:text-[9.5px]">
            {d.department}
          </p>
        </div>
      </div>
    </Link>
  );
}

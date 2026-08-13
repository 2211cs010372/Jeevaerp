"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowUpRight } from "@/components/ui/hugeicons";
import { DoctorAvatar } from "@/components/marketing/doctor-avatar";
import { OpdBand } from "@/components/marketing/opd-band";
import { DoctorSlots } from "@/components/marketing/doctor-slots";
import { DEPARTMENTS, DOCTORS, type Doctor } from "@/lib/data";
import { doctorHref } from "@/lib/doctors";

/**
 * The booking page: department -> doctor -> a real time.
 *
 * Steps 3 onwards are DoctorSlots, the same panel the profile page uses. That
 * is deliberate. This form used to build its own slot grid from the marketing
 * OPD string and mark slots taken with a hash of the doctor id - convincing to
 * look at, connected to nothing. There is now exactly one booking
 * implementation in the public site, reading the hospital's real diary and
 * writing real appointments, so the two surfaces can never drift apart or
 * offer a time the other has already filled.
 */

const label = "font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--muted)]";

export function BookingForm() {
  const params = useSearchParams();
  const preselected = DOCTORS.find((d) => d.id === params.get("doctor"));
  const deptParam = params.get("dept");

  const [dept, setDept] = useState(
    preselected?.department ?? (DEPARTMENTS.some((d) => d.name === deptParam) ? deptParam! : "")
  );
  const [doctorId, setDoctorId] = useState(preselected?.id ?? "");

  const doctors = useMemo(() => DOCTORS.filter((d) => !dept || d.department === dept), [dept]);
  const doctor = DOCTORS.find((d) => d.id === doctorId);

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[7fr_5fr]">
      <div className="min-w-0 rounded-[1.75rem] bg-white p-6 ring-1 ring-black/5 sm:p-8">
        {/* 01 - department */}
        <div>
          <p className={label}>01 - Department</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {DEPARTMENTS.map((d) => {
              const active = dept === d.name;
              return (
                <button key={d.name} type="button"
                  onClick={() => {
                    const next = active ? "" : d.name;
                    setDept(next);
                    if (doctor && next && doctor.department !== next) setDoctorId("");
                  }}
                  aria-pressed={active}
                  className={`rounded-full border px-3.5 py-2 text-[12.5px] font-medium transition-colors ${
                    active
                      ? "border-transparent bg-[var(--teal)] text-white"
                      : "border-[var(--line-strong)] text-[var(--ink-soft)] hover:border-[var(--teal)] hover:text-[var(--teal)]"
                  }`}>
                  {d.name}
                </button>
              );
            })}
          </div>
        </div>

        {/* 02 - doctor */}
        <div className="mt-8 border-t border-[var(--line)] pt-7">
          <div className="flex items-baseline justify-between gap-4">
            <p className={label}>02 - Doctor</p>
            <Link href="/doctors" className="text-[12px] font-semibold text-[var(--teal)] hover:underline">
              Compare profiles →
            </Link>
          </div>
          <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
            {doctors.map((d) => {
              const active = doctorId === d.id;
              return (
                <button key={d.id} type="button"
                  onClick={() => setDoctorId(active ? "" : d.id)}
                  aria-pressed={active}
                  className={`flex items-center gap-3.5 rounded-[1.1rem] border p-3.5 text-left transition-all ${
                    active
                      ? "border-[var(--teal)] bg-[var(--teal-soft)] shadow-[var(--shadow-sm)]"
                      : "border-[var(--line)] hover:border-[var(--teal-tint)] hover:bg-[var(--bone)]"
                  }`}>
                  <DoctorAvatar name={d.name} image={d.image} className="h-12 w-12 flex-none rounded-full text-[14px]" />
                  <span className="min-w-0">
                    <span className="block truncate text-[13.5px] font-semibold text-[var(--ink)]">{d.name}</span>
                    <span className="block truncate text-[11.5px] text-[var(--teal)]">{d.specialization}</span>
                    <span className="mt-0.5 block font-mono text-[10px] text-[var(--muted)]">{d.days} · {d.opd} · ₹{d.fee}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* 03 - the real diary */}
        <div className="mt-8 border-t border-[var(--line)] pt-7">
          <p className={label}>03 - Time & confirmation</p>
          <div className="mt-3">
            {doctor ? (
              <DoctorSlots doctorName={doctor.name} days={doctor.days} fee={doctor.fee} opd={doctor.opd} />
            ) : (
              <p className="rounded-[1.1rem] border border-dashed border-[var(--line-strong)] px-4 py-8 text-center text-[13px] text-[var(--muted)]">
                Choose a doctor above and their open times appear here.
              </p>
            )}
          </div>
        </div>
      </div>

      <DoctorRail doctor={doctor} />
    </div>
  );
}

/** The sticky rail - who you've chosen, and when they sit. */
function DoctorRail({ doctor }: { doctor?: Doctor }) {
  if (!doctor) {
    return (
      <aside className="flex h-full min-h-[280px] flex-col items-center justify-center rounded-[1.75rem] border-2 border-dashed border-[var(--line-strong)] p-8 text-center lg:sticky lg:top-28">
        <span className="grid h-12 w-12 place-items-center rounded-full bg-[var(--teal-soft)] text-[var(--teal)]" aria-hidden>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
            <circle cx="12" cy="8" r="4" /><path d="M4 20c0-3.3 3.6-5.5 8-5.5s8 2.2 8 5.5" />
          </svg>
        </span>
        <p className="mt-4 text-[14.5px] font-semibold text-[var(--ink)]">No doctor selected yet</p>
        <p className="mt-1.5 max-w-[240px] text-[13px] leading-[1.65] text-[var(--muted)]">
          Choose a doctor and their timings and fee appear here.
        </p>
        <Link href="/doctors" className="mt-4 text-[13px] font-semibold text-[var(--teal)] underline underline-offset-2">
          Browse all doctors
        </Link>
      </aside>
    );
  }

  return (
    <aside className="h-fit min-w-0 lg:sticky lg:top-28">
      <div className="rounded-[1.75rem] bg-[var(--peach-soft)] p-1.5 ring-1 ring-black/5">
        <div className="glass rounded-[1.35rem] p-5">
          <div className="flex items-start gap-4">
            <DoctorAvatar name={doctor.name} image={doctor.image} className="h-[76px] w-[76px] flex-none rounded-[1rem] text-[20px]" />
            <div className="min-w-0 flex-1">
              <h3 className="truncate text-[16px] font-semibold text-[var(--ink)]">{doctor.name}</h3>
              <p className="mt-0.5 text-[12.5px] font-medium text-[var(--teal)]">{doctor.specialization}</p>
              <p className="mt-0.5 truncate text-[11.5px] text-[var(--muted)]">{doctor.qualification}</p>
              <Link href={doctorHref(doctor)}
                className="mt-1.5 inline-flex items-center gap-1 text-[11.5px] font-semibold text-[var(--teal)] hover:underline">
                Full profile <ArrowUpRight className="h-3 w-3" />
              </Link>
            </div>
          </div>
          <div className="mt-5 border-t border-[var(--line)] pt-4">
            <OpdBand opd={doctor.opd} days={doctor.days} />
          </div>
        </div>
      </div>

      <div className="relative mt-4 overflow-hidden rounded-[1.75rem] bg-[var(--pine-ink)] p-6 text-white ring-1 ring-black/10">
        <div aria-hidden className="absolute -right-10 -top-10 h-36 w-36 rounded-full bg-[var(--teal)]/40 blur-2xl" />
        <div className="relative z-10">
          <div className="flex items-baseline justify-between">
            <p className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-white/55">Consultation</p>
            <p className="display text-[1.9rem] leading-none text-white">
              <span className="align-top text-[1rem] text-white/60">₹</span>{doctor.fee}
            </p>
          </div>
          <p className="mt-4 border-t border-white/12 pt-3 text-[11.5px] leading-relaxed text-white/55">
            Paid at the hospital. Booking is free, and we&apos;ll text a code to confirm the number is yours.
          </p>
        </div>
      </div>
    </aside>
  );
}

import Link from "next/link";
import { ArrowUpRight, ArrowLeft, Phone } from "lucide-react";
import { Reveal } from "@/components/ui/reveal";
import { DoctorAvatar } from "@/components/marketing/doctor-avatar";
import { OpdBand } from "@/components/marketing/opd-band";
import { DoctorSlots } from "@/components/marketing/doctor-slots";
import { DoctorTabs } from "@/components/marketing/doctor-tabs";
import { HOSPITAL, type Doctor } from "@/lib/data";
import { dailyHours, daysInWords } from "@/lib/opd";

/**
 * Doctor profile - judge, then book, without leaving the page.
 *
 * Two columns, because those are two different jobs: the left is "is this the
 * right person", the right is "when can I see them". Putting the times beside
 * the credentials instead of behind a second page removes the step where most
 * people used to drop out.
 *
 * Below both, the long-form description sits in tabs with the FAQs alongside -
 * read only by people who are still deciding, so it stays out of the way of the
 * ones who already know.
 */
export function DoctorProfile({
  doctor, peers, peersLabel,
}: { doctor: Doctor; peers: Doctor[]; peersLabel: string }) {
  const emergency = HOSPITAL.emergency.replace(/\s/g, "");

  return (
    <div className="mx-auto max-w-[1200px] px-5 pb-24 pt-28 lg:px-8 lg:pt-36">
      <Reveal>
        <Link
          href="/doctors"
          className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--muted)] transition-colors hover:text-[var(--teal)]"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> All doctors
        </Link>
      </Reveal>

      {/* ══ LEFT: who they are · RIGHT: when you can see them ══════════════ */}
      <div className="mt-6 grid items-start gap-4 lg:grid-cols-[1.35fr_1fr]">
        {/* ---- left: photo, specifications, timings ---- */}
        <Reveal className="min-w-0">
          <div className="rounded-[1.75rem] bg-[var(--peach-soft)] p-1.5 ring-1 ring-black/5">
            <div className="glass rounded-[1.35rem] p-5 sm:p-7">
              <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
                <DoctorAvatar
                  name={doctor.name}
                  image={doctor.image}
                  eager
                  className="aspect-[4/5] w-full shrink-0 rounded-[1.1rem] text-[34px] shadow-[var(--shadow-sm)] sm:w-[168px]"
                />
                <div className="min-w-0 flex-1">
                  <span className="rounded-full bg-[var(--teal-soft)] px-3 py-1 text-[11px] font-semibold text-[var(--teal-deep)]">
                    {doctor.department}
                  </span>
                  <h1 className="display mt-3 text-[clamp(1.7rem,3.4vw,2.3rem)] text-[var(--ink)]">
                    {doctor.name}
                  </h1>
                  <p className="mt-1 text-[14.5px] font-medium text-[var(--teal)]">{doctor.specialization}</p>
                  <p className="mt-1.5 text-[13px] text-[var(--muted)]">{doctor.qualification}</p>

                  <a
                    href={`tel:${emergency}`}
                    className="mt-4 inline-flex items-center gap-2 rounded-full border border-[var(--line-strong)] bg-white px-4 py-2 text-[12.5px] font-semibold text-[var(--ink)] transition-colors hover:border-[var(--teal)] hover:text-[var(--teal)]"
                  >
                    <Phone className="h-3.5 w-3.5" /> Call the desk
                  </a>
                </div>
              </div>

              {/* specifications - the numbers, in one scannable row */}
              <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-[var(--line)] pt-5 sm:grid-cols-4">
                <Spec k="Fee" v={`₹${doctor.fee}`} accent />
                <Spec k="Experience" v={`${doctor.experience} yrs`} />
                <Spec k="At the desk" v={`${dailyHours(doctor.opd)} hrs/day`} />
                <Spec k="Speaks" v={doctor.languages.split(",")[0].trim()} />
              </dl>

              {/* timings - the OPD board */}
              <div className="mt-6 border-t border-[var(--line)] pt-5">
                <OpdBand opd={doctor.opd} days={doctor.days} variant="full" />
              </div>
            </div>
          </div>
        </Reveal>

        {/* ---- right: live slots ---- */}
        <Reveal delay={80} className="min-w-0">
          <DoctorSlots doctorName={doctor.name} days={doctor.days} fee={doctor.fee} opd={doctor.opd} />
        </Reveal>
      </div>

      {/* ══ BELOW: the long read - tabs + FAQs ════════════════════════════ */}
      <Reveal delay={40}>
        <DoctorTabs doctor={doctor} />
      </Reveal>

      {/* ══ the rest of the panel ═════════════════════════════════════════ */}
      {peers.length > 0 && (
        <Reveal delay={60}>
          <div className="mt-10">
            <p className="sec-index">{peersLabel}</p>
            <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {peers.map((p) => (
                <Link
                  key={p.id}
                  href={`/doctors/${p.id}`}
                  className="card card-hover group flex items-center gap-4 p-4"
                >
                  <DoctorAvatar name={p.name} image={p.image} className="h-14 w-14 flex-none rounded-full text-[14px]" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-semibold text-[var(--ink)]">{p.name}</span>
                    <span className="block truncate text-[12px] text-[var(--teal)]">{p.specialization}</span>
                    <span className="mt-0.5 block font-mono text-[10.5px] text-[var(--muted)]">{p.days} · {p.opd}</span>
                  </span>
                  <ArrowUpRight className="h-4 w-4 flex-none text-[var(--muted)] transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-[var(--teal)]" />
                </Link>
              ))}
            </div>
          </div>
        </Reveal>
      )}
    </div>
  );
}

function Spec({ k, v, accent }: { k: string; v: string; accent?: boolean }) {
  return (
    <div>
      <dt className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--muted)]">{k}</dt>
      <dd className={`mt-1 font-mono text-[17px] font-bold ${accent ? "text-[var(--teal)]" : "text-[var(--ink)]"}`}>{v}</dd>
    </div>
  );
}

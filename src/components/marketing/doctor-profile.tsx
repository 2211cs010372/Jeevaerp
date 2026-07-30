import Link from "next/link";
import { ArrowUpRight, ArrowLeft, Phone } from "lucide-react";
import { DoctorAvatar } from "@/components/marketing/doctor-avatar";
import { OpdBand } from "@/components/marketing/opd-band";
import { DoctorSlots } from "@/components/marketing/doctor-slots";
import { DoctorTabs } from "@/components/marketing/doctor-tabs";
import { Chapter, Rule } from "@/components/marketing/section";
import { Reveal, SplitLead, Stagger } from "@/components/marketing/motion";
import { HOSPITAL, type Doctor } from "@/lib/data";
import { dailyHours, daysInWords } from "@/lib/opd";

/**
 * Doctor profile - judge, then book, without leaving the page.
 *
 * The masthead is the same pine band every inner page opens on, but it carries
 * the portrait and the four numbers a family weighs: fee, experience, hours at
 * the desk, and the language they'll be seen in. Below it, two columns, because
 * those are two different jobs: the left is "is this the right person", the
 * right is "when can I see them". Putting the times beside the credentials
 * instead of behind a second page removes the step where most people dropped out.
 *
 * Below both, the long-form description sits in tabs with the FAQs alongside -
 * read only by people who are still deciding, so it stays out of the way of the
 * ones who already know.
 */
export function DoctorProfile({
  doctor,
  peers,
  peersLabel,
}: {
  doctor: Doctor;
  peers: Doctor[];
  peersLabel: string;
}) {
  const emergency = HOSPITAL.emergency.replace(/\s/g, "");

  return (
    <div className="bg-[var(--bone)]">
      {/* ══ MASTHEAD ══════════════════════════════════════════════════════ */}
      <section className="relative isolate overflow-hidden bg-[var(--pine-ink)] below-nav pb-14 text-white lg:pb-16">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(115%_85%_at_18%_-10%,rgba(23,112,95,0.3),transparent_62%)]"
        />

        <div className="shell-w">
          <Link
            href="/doctors"
            className="mono inline-flex items-center gap-2 text-[10.5px] uppercase tracking-[0.18em] text-white/60 transition-colors hover:text-white"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> All doctors
          </Link>

          <div className="mt-8 rule-row rule-row-dark">
            <span className="rule-idx">(dr)</span>
            <span className="rule-line" />
            <span className="rule-label">{doctor.department}</span>
          </div>

          <div className="mt-9 flex flex-col gap-8 sm:mt-12 sm:flex-row sm:items-end">
            <Reveal className="shrink-0" y={26}>
              <DoctorAvatar
                name={doctor.name}
                image={doctor.image}
                eager
                className="aspect-[4/5] w-[168px] rounded-[var(--r-lg)] text-[34px] sm:w-[184px]"
              />
            </Reveal>

            <div className="min-w-0 flex-1">
              <SplitLead
                as="h1"
                immediate
                delay={0.08}
                className="display-lead text-white"
                lines={[{ text: doctor.name }]}
              />
              <Reveal as="p" delay={0.28} y={16} className="mt-4 text-[16px] font-medium text-[var(--teal-tint)]">
                {doctor.specialization}
              </Reveal>
              <Reveal
                as="p"
                delay={0.32}
                y={14}
                className="mono mt-2 text-[11.5px] uppercase tracking-[0.14em] text-white/50"
              >
                {doctor.qualification}
              </Reveal>

              <Reveal delay={0.4} y={16} className="mt-7 flex flex-wrap gap-2.5">
                <a href={`tel:${emergency}`} className="btn btn-ghost-dark !py-3 !text-[13px]">
                  <Phone className="h-3.5 w-3.5" /> Call the desk
                </a>
              </Reveal>
            </div>
          </div>

          {/* the numbers, in one scannable row */}
          <Stagger
            as="dl"
            each={0.07}
            y={18}
            className="grid-lines grid-lines-dark mt-12 grid grid-cols-2 !border-t-white/20 sm:grid-cols-4"
          >
            <Spec k="Consultation fee" v={`₹${doctor.fee}`} accent />
            <Spec k="Experience" v={`${doctor.experience} yrs`} />
            <Spec k="At the desk" v={`${dailyHours(doctor.opd)} hrs/day`} />
            <Spec k="Consulting" v={daysInWords(doctor.days)} />
          </Stagger>
        </div>
      </section>

      {/* ══ LEFT: the OPD board · RIGHT: when you can see them ════════════ */}
      <Chapter tone="light" className="chapter-tight">
        <div className="grid items-start gap-4 lg:grid-cols-[1.35fr_1fr]">
          <Reveal className="card min-w-0 p-6 sm:p-8" y={26}>
            <Rule label="Consulting hours" />
            <div className="mt-7">
              <OpdBand opd={doctor.opd} days={doctor.days} variant="full" />
            </div>
            <p className="mt-7 border-t border-[var(--line)] pt-6 text-[13.5px] leading-[1.7] text-[var(--ink-soft)]">
              {doctor.bio}
            </p>
          </Reveal>

          <Reveal delay={0.1} className="min-w-0" y={26}>
            <DoctorSlots
              doctorName={doctor.name}
              days={doctor.days}
              fee={doctor.fee}
              opd={doctor.opd}
            />
          </Reveal>
        </div>
      </Chapter>

      {/* ══ BELOW: the long read - tabs + FAQs ═══════════════════════════ */}
      <Chapter tone="paper" className="chapter-tight">
        <DoctorTabs doctor={doctor} />
      </Chapter>

      {/* ══ the rest of the panel ════════════════════════════════════════ */}
      {peers.length > 0 && (
        <Chapter tone="light" className="chapter-tight">
          <Rule label={peersLabel} />

          <Stagger
            each={0.05}
            y={20}
            className="mt-8 grid border-t border-[var(--line-strong)] sm:grid-cols-2 lg:grid-cols-3"
          >
            {peers.map((p) => (
              <Link
                key={p.id}
                href={`/doctors/${p.id}`}
                className="group flex items-center gap-4 border-b border-[var(--line)] px-1 py-5 transition-colors hover:bg-[var(--paper)] sm:px-5 lg:border-l lg:first:border-l-0"
              >
                <DoctorAvatar
                  name={p.name}
                  image={p.image}
                  className="h-14 w-14 flex-none rounded-full text-[14px]"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14.5px] font-semibold tracking-[-0.02em] text-[var(--ink)]">
                    {p.name}
                  </span>
                  <span className="block truncate text-[12px] text-[var(--teal)]">
                    {p.specialization}
                  </span>
                  <span className="mono mt-1 block truncate text-[10px] uppercase tracking-[0.12em] text-[var(--muted)]">
                    {p.days} · {p.opd}
                  </span>
                </span>
                <ArrowUpRight className="h-4 w-4 flex-none text-[var(--line-strong)] transition-all duration-400 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-[var(--teal)]" />
              </Link>
            ))}
          </Stagger>
        </Chapter>
      )}
    </div>
  );
}

function Spec({ k, v, accent }: { k: string; v: string; accent?: boolean }) {
  return (
    <div className="py-6 sm:pl-8 sm:first:pl-0">
      <dt className="mono text-[9.5px] uppercase tracking-[0.16em] text-white/45">{k}</dt>
      <dd
        className={`mono mt-2 text-[19px] font-semibold tabular ${
          accent ? "text-[var(--teal-tint)]" : "text-white"
        }`}
      >
        {v}
      </dd>
    </div>
  );
}

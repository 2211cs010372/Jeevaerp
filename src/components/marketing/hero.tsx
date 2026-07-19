import Link from "next/link";
import { Reveal } from "@/components/ui/reveal";
import { DoctorAvatar } from "@/components/marketing/doctor-avatar";
import { HOSPITAL, DOCTORS } from "@/lib/data";

/**
 * Hero — one sky-blue panel: friendly headline left, a doctor on the organic
 * blue curve right, and the "(001)" editorial index carrying the sub-copy.
 */
export function Hero() {
  const lead = DOCTORS[0];
  return (
    <section className="px-3 pt-24 sm:px-5 lg:pt-28">
      <div className="mx-auto max-w-[1280px]">
        <div className="relative overflow-hidden rounded-[28px] bg-[var(--sky)]">
          {/* the organic curve behind the doctor — drifting, barely */}
          <div aria-hidden className="drift-slow pointer-events-none absolute -right-24 -top-40 hidden h-[560px] w-[560px] rounded-full bg-[var(--teal-lift)]/30 lg:block" />
          <div aria-hidden className="drift drift-delay pointer-events-none absolute -bottom-48 right-40 hidden h-[480px] w-[480px] rounded-full bg-white/40 lg:block" />

          <div className="relative grid gap-8 px-7 pb-0 pt-12 sm:px-12 lg:grid-cols-[1.15fr_0.85fr] lg:pt-16">
            {/* copy */}
            <div className="pb-10 lg:pb-16">
              <Reveal>
                <Link href="/book"
                  className="mb-5 inline-flex items-center gap-2 rounded-full bg-white/70 py-2 pl-3.5 pr-4 text-[12px] font-semibold text-[var(--ink)] shadow-[var(--shadow-sm)] backdrop-blur transition-colors hover:bg-white">
                  <span className="text-[var(--teal)]" aria-hidden>✦</span>
                  Online booking is live
                  <span aria-hidden>→</span>
                </Link>
              </Reveal>
              <Reveal delay={40}>
                <h1 className="display text-[clamp(2.1rem,4.6vw,3.6rem)] text-[var(--ink)]">
                  Feel better, <span className="text-[var(--teal-deep)]">faster</span> —<br />care that&apos;s got your back
                </h1>
              </Reveal>
              <Reveal delay={90}>
                <div className="mt-6 flex max-w-md items-start gap-5">
                  <span className="idx mt-1 shrink-0">(001)</span>
                  <p className="text-[14.5px] leading-[1.75] text-[var(--ink-soft)]">
                    See a specialist, get your tests done and collect your medicines —
                    all in one building in {HOSPITAL.locality.split(",")[0]}. Walk in,
                    or book a time that suits you.
                  </p>
                </div>
              </Reveal>
              <Reveal delay={160}>
                <div className="mt-7 flex flex-wrap items-center gap-3">
                  <Link href="/book" className="btn btn-solid">Book appointment</Link>
                  <a href={`tel:${HOSPITAL.phone.replace(/\s/g, "")}`}
                    className="btn border border-[var(--ink)]/15 bg-white/60 text-[var(--ink)] hover:bg-white">
                    Call the hospital
                  </a>
                </div>
              </Reveal>
              <Reveal delay={220}>
                <div className="mt-7 flex flex-wrap gap-2">
                  <span className="chip !border-transparent !bg-white/70">OPD {HOSPITAL.opdHours}</span>
                  <span className="chip !border-transparent !bg-white/70">Mon – Sat</span>
                  <span className="chip !border-transparent !bg-white/70 !text-[var(--alert)]">Emergency 24×7</span>
                </div>
              </Reveal>
            </div>

            {/* the doctor, standing on the curve */}
            <Reveal delay={140} className="relative hidden lg:block">
              <div className="absolute bottom-0 right-4 w-[340px] xl:w-[380px]">
                <DoctorAvatar name={lead.name} image={lead.image}
                  className="aspect-[4/5] w-full rounded-t-[180px] object-cover text-[40px] shadow-[0_24px_60px_-24px_rgba(16,24,40,0.35)]" />
                {/* floating proof card */}
                <div className="drift absolute -left-16 bottom-8 w-[190px] rounded-2xl bg-white p-4 shadow-[var(--shadow)]">
                  <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--muted)]">Consulting today</p>
                  <p className="mt-1 text-[13.5px] font-semibold text-[var(--ink)]">{lead.name}</p>
                  <p className="text-[11.5px] text-[var(--teal)]">{lead.specialization}</p>
                  <p className="mt-1.5 font-mono text-[11px] text-[var(--muted)]">{lead.opd} · ₹{lead.fee}</p>
                </div>
              </div>
            </Reveal>
          </div>
        </div>
      </div>
    </section>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { PhoneCall, User, Menu, X, ChevronDown, ArrowRight } from "lucide-react";
import { DeptIcon } from "@/components/marketing/dept-icon";
import { DoctorSearchBox } from "@/components/marketing/doctor-search-box";
import { DoctorAvatar } from "@/components/marketing/doctor-avatar";
import { HOSPITAL, DEPARTMENTS, DOCTORS, CARE_AREAS, type CareArea, type Department } from "@/lib/data";
import { careHref } from "@/lib/care";

/**
 * Two-row navbar with care-area mega-menus.
 *
 *   Row 1 - wordmark · search · appointment + emergency lines · login.
 *   Row 2 - Child Care / Women Care / Heart Care / … each opening a full-width
 *           panel listing EVERYTHING that care area covers.
 *
 * Organised by care area rather than by clinical department because that is how
 * people arrive: nobody searches for "Orthopaedics", they search for a bone
 * doctor, or they only know that something is wrong with their child. The
 * department is still the heading inside the panel, so the clinical structure
 * is visible - it just isn't the front door.
 *
 * Every sub-item links to the consultant who actually treats it, because that
 * page carries their live slots: one click from "Vaccination schedule" to a
 * bookable time.
 */

const deptsOf = (a: CareArea) => DEPARTMENTS.filter((d) => a.departments.includes(d.name));
const doctorsOf = (dept: string) => DOCTORS.filter((d) => d.department === dept);

/**
 * Services land on the department page, not straight on a doctor.
 * That page carries the full service list, the clinic hours and the consultant
 * - and it's the page a search engine can actually rank for "child vaccination
 * Hanamkonda". The consultant (and their live slots) is one click on from there.
 */
const serviceHref = (dept: string) => careHref(dept);

const LINKS = [
  { label: "Doctors", href: "/doctors" },
  { label: "Health checks", href: "/health-checks" },
  { label: "Rooms & prices", href: "/#wards" },
  { label: "Visit us", href: "/#visit" },
];

export function Navbar() {
  const [menu, setMenu] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [mobileArea, setMobileArea] = useState<string | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const phone = HOSPITAL.phone.replace(/\s/g, "");
  const emergency = HOSPITAL.emergency.replace(/\s/g, "");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setMenu(null); setOpen(false); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // A small grace period on leave: the pointer has to cross a gap between the
  // trigger and the panel, and snapping shut mid-journey is maddening.
  const hold = (label: string) => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setMenu(label);
  };
  const release = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setMenu(null), 120);
  };

  const close = () => { setMenu(null); setOpen(false); };

  return (
    <header className="fixed inset-x-0 top-0 z-50 bg-[var(--paper)] shadow-[var(--shadow-sm)]">
      {/* ── Row 1 - brand · search · actions ─────────────────────── */}
      <div className="border-b border-[var(--line)]">
        <div className="mx-auto flex max-w-[1280px] items-center gap-3 px-4 py-2.5 sm:gap-4 sm:px-5">
          <Link href="/" className="flex shrink-0 items-center gap-2.5" aria-label="Jeeva - home" onClick={close}>
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-[var(--teal)] text-white" aria-hidden>
              <svg width="13" height="13" viewBox="0 0 14 14"><path d="M5 0h4v5h5v4H9v5H5V9H0V5h5z" fill="currentColor" /></svg>
            </span>
            <span className="leading-none">
              <span className="display block text-[19px] text-[var(--ink)]">Jeeva</span>
              <span className="mt-0.5 hidden text-[8.5px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)] sm:block" style={{ fontFamily: "var(--font-mono)" }}>Multispeciality · Diagnostics · Pharmacy</span>
            </span>
          </Link>

          <DoctorSearchBox onNavigate={close} />

          <div className="flex shrink-0 items-center gap-2">
            <a href={`tel:${phone}`} className="hidden items-center gap-2 rounded-full border border-[var(--line-strong)] px-2.5 py-1.5 transition-colors hover:border-[var(--teal)] xl:inline-flex">
              <span className="grid h-7 w-7 place-items-center rounded-full bg-[var(--teal-soft)] text-[var(--teal)]"><PhoneCall size={13} /></span>
              <span className="leading-tight">
                <span className="block text-[8.5px] font-semibold uppercase tracking-wide text-[var(--muted)]">For appointment</span>
                <span className="block text-[12.5px] font-bold text-[var(--ink)]" style={{ fontFamily: "var(--font-mono)" }}>{HOSPITAL.phone}</span>
              </span>
            </a>
            <a href={`tel:${emergency}`} className="hidden items-center gap-2 rounded-full border border-[var(--alert)]/30 bg-[var(--alert-soft)] px-2.5 py-1.5 sm:inline-flex">
              <span className="grid h-7 w-7 place-items-center rounded-full bg-[var(--alert)] text-white"><PhoneCall size={13} /></span>
              <span className="leading-tight">
                <span className="block text-[8.5px] font-semibold uppercase tracking-wide text-[var(--alert)]">Emergency 24×7</span>
                <span className="block text-[12.5px] font-bold text-[var(--alert)]" style={{ fontFamily: "var(--font-mono)" }}>{HOSPITAL.emergency}</span>
              </span>
            </a>
            <Link href="/portal/login" aria-label="Login" className="grid h-9 w-9 place-items-center rounded-full border border-[var(--line-strong)] text-[var(--ink)] transition-colors hover:border-[var(--teal)] hover:text-[var(--teal)]" onClick={close}>
              <User size={16} />
            </Link>
            <button onClick={() => setOpen((v) => !v)} aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open}
              className="grid h-9 w-9 place-items-center rounded-full border border-[var(--line-strong)] text-[var(--ink)] lg:hidden">
              {open ? <X size={16} /> : <Menu size={16} />}
            </button>
          </div>
        </div>
      </div>

      {/* ── Row 2 - care areas + mega-menus (desktop) ────────────── */}
      <div className="relative hidden lg:block" onMouseLeave={release}>
        <div className="mx-auto flex max-w-[1280px] items-center px-5">
          {CARE_AREAS.map((area) => {
            const on = menu === area.label;
            return (
              <button
                key={area.label}
                onMouseEnter={() => hold(area.label)}
                onClick={() => setMenu(on ? null : area.label)}
                aria-expanded={on}
                aria-haspopup="true"
                className={`flex shrink-0 items-center gap-1 border-b-2 px-3 py-2.5 text-[16px] font-medium transition-colors ${
                  on ? "border-[var(--teal)] text-[var(--teal)]" : "border-transparent text-[var(--ink-soft)] hover:text-[var(--teal)]"
                }`}
              >
                {area.label}
                <ChevronDown size={12} className={`transition-transform ${on ? "rotate-180" : ""}`} />
              </button>
            );
          })}

          <span className="mx-2 h-4 w-px shrink-0 bg-[var(--line-strong)]" aria-hidden />

          {LINKS.map((l) => (
            <Link key={l.label} href={l.href} onMouseEnter={release} onClick={close}
              className="shrink-0 whitespace-nowrap border-b-2 border-transparent px-3 py-2.5 text-[16px] font-medium text-[var(--ink-soft)] transition-colors hover:text-[var(--teal)]">
              {l.label}
            </Link>
          ))}
        </div>

        {menu && (
          <div
            className="mega-in absolute inset-x-0 top-full border-b border-[var(--line)] bg-[var(--paper)] shadow-[var(--shadow)]"
            onMouseEnter={() => hold(menu)}
          >
            <CarePanel area={CARE_AREAS.find((a) => a.label === menu)!} onNavigate={close} />
          </div>
        )}
      </div>

      {/* ── mobile drawer ────────────────────────────────────────── */}
      {open && (
        <div className="max-h-[calc(100vh-58px)] overflow-y-auto border-t border-[var(--line)] bg-[var(--paper)] lg:hidden">
          <div className="space-y-3 px-4 py-3">
            <DoctorSearchBox variant="mobile" onNavigate={close} />

            {CARE_AREAS.map((area) => {
              const on = mobileArea === area.label;
              return (
                <div key={area.label} className="overflow-hidden rounded-xl border border-[var(--line)]">
                  <button onClick={() => setMobileArea(on ? null : area.label)} aria-expanded={on}
                    className="flex w-full items-center gap-3 px-3.5 py-3 text-left">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[var(--teal-soft)] text-[var(--teal)]">
                      <DeptIcon name={area.departments[0]} className="h-5 w-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[14px] font-semibold text-[var(--ink)]">{area.label}</span>
                      <span className="block truncate text-[11px] text-[var(--muted)]">{area.blurb}</span>
                    </span>
                    <ChevronDown size={15} className={`shrink-0 transition-transform ${on ? "rotate-180" : ""}`} />
                  </button>

                  {on && (
                    <div className="space-y-4 border-t border-[var(--line)] bg-[var(--bone)] p-3">
                      {deptsOf(area).map((d) => (
                        <div key={d.name}>
                          <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--teal)]" style={{ fontFamily: "var(--font-mono)" }}>
                            {d.name}
                          </p>
                          <div className="grid grid-cols-2 gap-1">
                            {d.services.map((s) => (
                              <Link key={s.name} href={serviceHref(d.name)} onClick={close}
                                className="rounded-lg px-2 py-1.5 text-[12px] leading-snug text-[var(--ink-soft)] hover:bg-white hover:text-[var(--teal)]">
                                {s.name}
                              </Link>
                            ))}
                          </div>
                          <Link href={`/book?dept=${encodeURIComponent(d.name)}`} onClick={close}
                            className="mt-2 inline-block text-[12px] font-semibold text-[var(--teal)]">
                            Book {d.name} →
                          </Link>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            {LINKS.map((l) => (
              <Link key={l.label} href={l.href} onClick={close} className="block border-b border-[var(--line)] px-1 py-2.5 text-[14px] font-medium text-[var(--ink-soft)]">{l.label}</Link>
            ))}

            <div className="grid grid-cols-2 gap-2 pt-1">
              <a href={`tel:${phone}`} className="rounded-full border border-[var(--line-strong)] py-2.5 text-center text-[13px] font-semibold text-[var(--ink)]">Appointment</a>
              <a href={`tel:${emergency}`} className="rounded-full bg-[var(--alert-soft)] py-2.5 text-center text-[13px] font-semibold text-[var(--alert)]">Emergency 24×7</a>
            </div>
            <Link href="/portal/login" onClick={close} className="flex items-center justify-center gap-1.5 rounded-full bg-[var(--ink)] py-2.5 text-[14px] font-semibold text-white">
              <User size={15} /> Login
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   The panel. Left rail says what this care area IS and who runs it; the rest
   is the full list of what it covers, in newspaper columns so a long list
   stays scannable instead of becoming a scroll.
   ───────────────────────────────────────────────────────────────────────── */
function CarePanel({ area, onNavigate }: { area: CareArea; onNavigate: () => void }) {
  const depts = deptsOf(area);
  const multi = depts.length > 1;
  const consultants = depts.flatMap((d) => doctorsOf(d.name));

  return (
    <div className="mx-auto max-w-[1280px] px-5 py-6">
      <div className="grid grid-cols-[236px_1fr] gap-7">
        {/* ---- what this area is ---- */}
        <aside className="rounded-2xl bg-[var(--teal-soft)] p-4">
          <span className="grid h-20 w-20 place-items-center rounded-xl bg-[var(--teal)]/20 text-white">
            <DeptIcon name={area.departments[0]} className="h-18 overflow-hidden w-18" />
          </span>
          <p className="display mt-3 text-[19px] text-[var(--ink)]">{area.label}</p>
          <p className="mt-1.5 text-[12px] leading-relaxed text-[var(--ink-soft)]">{area.blurb}</p>

          {consultants.length > 0 && (
            <div className="mt-4 space-y-1.5 border-t border-[var(--teal-tint)] pt-3">
              <p className="text-[9.5px] font-bold uppercase tracking-[0.14em] text-[var(--teal)]" style={{ fontFamily: "var(--font-mono)" }}>
                {consultants.length === 1 ? "Consultant" : "Consultants"}
              </p>
              {consultants.map((doc) => (
                <Link key={doc.id} href={`/doctors/${doc.id}`} onClick={onNavigate}
                  className="group flex items-center gap-2.5 rounded-xl bg-white/80 p-2 transition-colors hover:bg-white">
                  <span className="h-20 w-20 shrink-0 overflow-hidden rounded-lg ring-1 ring-[var(--line)]">
                    <DoctorAvatar name={doc.name} image={doc.image} className="h-full w-full  text-[11px]" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] font-semibold text-[var(--ink)]">{doc.name}</span>
                    <span className="block truncate text-[10.5px] text-[var(--teal)]">{doc.specialization}</span>
                  </span>
                  <ArrowRight size={13} className="shrink-0 text-[var(--muted)] transition-colors group-hover:text-[var(--teal)]" />
                </Link>
              ))}
            </div>
          )}
        </aside>

        {/* ---- everything it covers ---- */}
        <div className={multi ? "grid grid-cols-2 gap-x-7" : ""}>
          {depts.map((d) => (
            <DeptColumn key={d.name} dept={d} newspaper={!multi} onNavigate={onNavigate} />
          ))}
        </div>
      </div>
    </div>
  );
}

function DeptColumn({ dept, newspaper, onNavigate }: { dept: Department; newspaper: boolean; onNavigate: () => void }) {
  return (
    <div>
      <div className="mb-2.5 flex items-baseline justify-between gap-3 border-b border-[var(--line)] pb-2">
        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--teal)]" style={{ fontFamily: "var(--font-mono)" }}>
          {dept.name}
        </p>
        <Link href={`/book?dept=${encodeURIComponent(dept.name)}`} onClick={onNavigate}
          className="shrink-0 text-[11.5px] font-semibold text-[var(--teal)] hover:underline">
          Book →
        </Link>
      </div>
      {/* CSS columns keep an 11-item list three rows deep instead of eleven */}
      <ul className={newspaper ? "columns-3 gap-x-7" : ""}>
        {dept.services.map((s) => (
          <li key={s.name} className="break-inside-avoid">
            {/* the description rides along as a tooltip - it belongs on the
                department page, not crammed into a menu row */}
            <Link href={serviceHref(dept.name)} onClick={onNavigate} title={s.desc}
              className="block rounded-md py-[5px] text-[16px] leading-snug text-[var(--ink-soft)] transition-colors hover:text-[var(--teal)]">
              {s.name}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

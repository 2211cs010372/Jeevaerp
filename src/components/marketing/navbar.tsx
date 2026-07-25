"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Search, PhoneCall, User, Menu, X, ChevronDown, ArrowRight, Activity } from "lucide-react";
import { DeptIcon } from "@/components/marketing/dept-icon";
import { DoctorAvatar } from "@/components/marketing/doctor-avatar";
import { HOSPITAL, DEPARTMENTS, DOCTORS, CARE_AREAS, type CareArea, type Department } from "@/lib/data";
import { careHref } from "@/lib/care";

const deptsOf = (a: CareArea) => DEPARTMENTS.filter((d) => a.departments.includes(d.name));
const doctorsOf = (dept: string) => DOCTORS.filter((d) => d.department === dept);
const serviceHref = (dept: string) => careHref(dept);

const LINKS = [
  { label: "Doctors", href: "/doctors" },
  { label: "Health checks", href: "/health-checks" },
  { label: "Rooms & prices", href: "/#wards" },
  { label: "Visit us", href: "/#visit" },
];

export function Navbar() {
  const router = useRouter();
  const [menu, setMenu] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [mobileArea, setMobileArea] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const phone = HOSPITAL.phone.replace(/\s/g, "");
  const emergency = HOSPITAL.emergency.replace(/\s/g, "");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setMenu(null); setOpen(false); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const hold = (label: string) => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setMenu(label);
  };
  const release = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setMenu(null), 120);
  };

  function submitSearch(e: FormEvent) {
    e.preventDefault();
    router.push(q.trim() ? `/doctors?q=${encodeURIComponent(q.trim())}` : "/doctors");
    setOpen(false);
  }
  
  const close = () => { setMenu(null); setOpen(false); };

  return (
    <header className="fixed inset-x-0 top-0 z-50 p-3 sm:p-4 pointer-events-none">
      {/* ── Bento Container ─────────────────────── */}
      <div className="mx-auto max-w-[1280px] pointer-events-auto rounded-3xl bg-[var(--paper)]/90 backdrop-blur-md shadow-sm ring-1 ring-[var(--line)] transition-all">
        
        {/* ── Row 1 - brand · search · actions ─────────────────────── */}
        <div className="flex items-center gap-3 px-4 py-3 sm:gap-4 sm:px-5">
          <Link href="/" className="flex shrink-0 items-center gap-3" aria-label="Jeeva - home" onClick={close}>
            <span className="grid h-10 w-10 place-items-center rounded-2xl bg-[var(--teal)] text-white shadow-sm" aria-hidden>
              <Activity size={20} strokeWidth={2.5} />
            </span>
            <span className="leading-none">
              <span className="block text-[20px] font-bold text-[var(--ink)] tracking-tight">Jeeva</span>
              <span className="mt-1 hidden text-[9px] font-bold uppercase tracking-[0.15em] text-[var(--teal)] sm:block" style={{ fontFamily: "var(--font-mono)" }}>
                Multispeciality
              </span>
            </span>
          </Link>

          <form onSubmit={submitSearch} className="relative mx-auto hidden max-w-[480px] flex-1 lg:block">
            <Search size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search doctors, specialities…"
              className="w-full rounded-2xl border-none bg-[var(--bone)] py-3 pl-10 pr-12 text-[14px] font-medium text-[var(--ink)] outline-none ring-1 ring-[var(--line)] transition-all placeholder:text-[var(--muted)] focus:bg-white focus:ring-2 focus:ring-[var(--teal)] shadow-inner" />
            <button type="submit" aria-label="Search" className="absolute right-1.5 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-xl bg-[var(--teal)] text-white transition-transform hover:scale-105 active:scale-95 shadow-sm">
              <Search size={15} />
            </button>
          </form>

          <div className="flex shrink-0 items-center gap-2.5 ml-auto">
            <a href={`tel:${phone}`} className="hidden items-center gap-2.5 rounded-2xl bg-[var(--bone)] px-3 py-2 transition-all hover:bg-[var(--teal-soft)] hover:ring-1 hover:ring-[var(--teal)] ring-1 ring-transparent xl:flex">
              <span className="grid h-8 w-8 place-items-center rounded-xl bg-white text-[var(--teal)] shadow-sm"><PhoneCall size={14} /></span>
              <span className="leading-tight pr-1">
                <span className="block text-[9px] font-bold uppercase tracking-wider text-[var(--muted)]">Appointments</span>
                <span className="block text-[13px] font-bold text-[var(--ink)]" style={{ fontFamily: "var(--font-mono)" }}>{HOSPITAL.phone}</span>
              </span>
            </a>
            <a href={`tel:${emergency}`} className="hidden items-center gap-2.5 rounded-2xl bg-[var(--alert-soft)] px-3 py-2 ring-1 ring-[var(--alert)]/20 transition-all hover:bg-[var(--alert)]/15 sm:flex">
              <span className="grid h-8 w-8 place-items-center rounded-xl bg-[var(--alert)] text-white shadow-sm"><PhoneCall size={14} /></span>
              <span className="leading-tight pr-1">
                <span className="block text-[9px] font-bold uppercase tracking-wider text-[var(--alert)]">Emergency</span>
                <span className="block text-[13px] font-bold text-[var(--alert)]" style={{ fontFamily: "var(--font-mono)" }}>{HOSPITAL.emergency}</span>
              </span>
            </a>
            <Link href="/portal/login" aria-label="Login" className="grid h-10 w-10 place-items-center rounded-2xl bg-[var(--bone)] text-[var(--ink)] transition-all hover:bg-[var(--teal)] hover:text-white shadow-sm ring-1 ring-[var(--line)]" onClick={close}>
              <User size={18} />
            </Link>
            <button onClick={() => setOpen((v) => !v)} aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open}
              className="grid h-10 w-10 place-items-center rounded-2xl bg-[var(--bone)] text-[var(--ink)] lg:hidden transition-colors hover:bg-[var(--line)] shadow-sm ring-1 ring-[var(--line)]">
              {open ? <X size={18} /> : <Menu size={18} />}
            </button>
          </div>
        </div>

        {/* ── Row 2 - care areas + mega-menus (desktop) ────────────── */}
        <div className="relative hidden border-t border-[var(--line)]/50 lg:block" onMouseLeave={release}>
          <div className="flex items-center justify-between px-3 py-2">
            <div className="flex flex-1 items-center gap-1 overflow-x-auto no-scrollbar">
              {CARE_AREAS.map((area) => {
                const on = menu === area.label;
                return (
                  <button
                    key={area.label}
                    onMouseEnter={() => hold(area.label)}
                    onClick={() => setMenu(on ? null : area.label)}
                    aria-expanded={on}
                    aria-haspopup="true"
                    className={`flex shrink-0 items-center gap-1.5 rounded-xl px-3.5 py-2 text-[14px] font-semibold transition-all ${
                      on ? "bg-[var(--teal)] text-white shadow-md" : "text-[var(--ink-soft)] hover:bg-[var(--bone)] hover:text-[var(--teal)]"
                    }`}
                  >
                    {area.label}
                    <ChevronDown size={14} className={`transition-transform duration-300 ${on ? "rotate-180 opacity-70" : "opacity-50"}`} />
                  </button>
                );
              })}
            </div>

            <div className="flex shrink-0 items-center gap-1 pl-4 border-l border-[var(--line)]/50">
              {LINKS.map((l) => (
                <Link key={l.label} href={l.href} onMouseEnter={release} onClick={close}
                  className="rounded-xl px-3.5 py-2 text-[13px] font-semibold text-[var(--ink-soft)] transition-all hover:bg-[var(--bone)] hover:text-[var(--ink)]">
                  {l.label}
                </Link>
              ))}
            </div>
          </div>

          {/* ── Desktop Mega Menu Bento Dropdown ────────────── */}
          {menu && (
            <div 
              className="absolute inset-x-0 top-[calc(100%+12px)] z-50 rounded-3xl bg-[var(--paper)] p-2 shadow-2xl ring-1 ring-[var(--line)] origin-top animate-in fade-in zoom-in-95 duration-200"
              onMouseEnter={() => hold(menu)}
            >
              <CarePanel area={CARE_AREAS.find((a) => a.label === menu)!} onNavigate={close} />
            </div>
          )}
        </div>
      </div>

      {/* ── mobile drawer (Bento Style) ─────────────────────────── */}
      {open && (
        <div className="absolute inset-x-3 top-[calc(100%+12px)] pointer-events-auto max-h-[80vh] overflow-y-auto rounded-3xl bg-[var(--paper)] shadow-2xl ring-1  lg:hidden animate-in slide-in-from-top-4 fade-in duration-200 p-2">
          <div className="flex flex-col gap-2 p-1">
            <form onSubmit={submitSearch} className="relative w-full">
              <Search size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search doctors, specialities…"
                className="w-full rounded-2xl border-none bg-[var(--bone)] py-3.5 pl-10 pr-4 text-[14px] font-medium text-[var(--ink)] outline-none ring-1 ring-[var(--line)] focus:bg-white focus:ring-2 focus:ring-[var(--teal)] shadow-inner" />
            </form>

            <div className="grid grid-cols-2 gap-2">
              <a href={`tel:${phone}`} className="flex flex-col items-center justify-center gap-1 rounded-2xl bg-[var(--bone)] p-3 text-center transition-all active:scale-95">
                <span className="grid h-8 w-8 place-items-center rounded-full bg-[var(--teal-soft)] text-[var(--teal)]"><PhoneCall size={14} /></span>
                <span className="text-[12px] font-bold text-[var(--ink)]">Appointments</span>
              </a>
              <a href={`tel:${emergency}`} className="flex flex-col items-center justify-center gap-1 rounded-2xl bg-[var(--alert-soft)] p-3 text-center transition-all active:scale-95">
                <span className="grid h-8 w-8 place-items-center rounded-full bg-[var(--alert)] text-white"><PhoneCall size={14} /></span>
                <span className="text-[12px] font-bold text-[var(--alert)]">Emergency</span>
              </a>
            </div>

            <div className="flex flex-col gap-2 mt-2">
              {CARE_AREAS.map((area) => {
                const on = mobileArea === area.label;
                return (
                  <div key={area.label} className={`rounded-2xl border transition-colors ${on ? 'border-[var(--teal)] bg-[var(--teal-soft)]/20' : 'border-[var(--line)] bg-[var(--bone)]/50'}`}>
                    <button onClick={() => setMobileArea(on ? null : area.label)} aria-expanded={on}
                      className="flex w-full items-center gap-3 p-3 text-left">
                      <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl shadow-sm transition-colors ${on ? 'bg-[var(--teal)] text-white' : 'bg-white text-[var(--teal)] ring-1 ring-[var(--line)]'}`}>
                        <DeptIcon name={area.departments[0]} className="h-5 w-5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[15px] font-bold text-[var(--ink)]">{area.label}</span>
                        <span className="block truncate text-[12px] font-medium text-[var(--muted)]">{area.blurb}</span>
                      </span>
                      <ChevronDown size={18} className={`shrink-0 text-[var(--muted)] transition-transform duration-300 ${on ? "rotate-180 text-[var(--teal)]" : ""}`} />
                    </button>

                    {on && (
                      <div className="flex flex-col gap-3 px-3 pb-3">
                        {deptsOf(area).map((d) => (
                          <div key={d.name} className="rounded-xl bg-white p-3 shadow-sm ring-1 ring-[var(--line)]">
                            <div className="flex items-center justify-between mb-2">
                              <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-[var(--teal)]" style={{ fontFamily: "var(--font-mono)" }}>
                                {d.name}
                              </p>
                              <Link href={`/book?dept=${encodeURIComponent(d.name)}`} onClick={close}
                                className="rounded-lg bg-[var(--teal-soft)] px-2 py-1 text-[10px] font-bold text-[var(--teal)]">
                                BOOK
                              </Link>
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {d.services.map((s) => (
                                <Link key={s.name} href={serviceHref(d.name)} onClick={close}
                                  className="rounded-lg border border-[var(--line)] bg-[var(--bone)] px-2.5 py-1.5 text-[12px] font-medium text-[var(--ink-soft)] transition-colors hover:border-[var(--teal)] hover:bg-[var(--teal-soft)] hover:text-[var(--teal)]">
                                  {s.name}
                                </Link>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="grid grid-cols-2 gap-2 mt-2">
              {LINKS.map((l) => (
                <Link key={l.label} href={l.href} onClick={close} className="flex items-center justify-center rounded-2xl bg-[var(--bone)] p-3 text-[13px] font-bold text-[var(--ink-soft)] transition-all hover:bg-[var(--line)]">
                  {l.label}
                </Link>
              ))}
            </div>
            
            <Link href="/portal/login" onClick={close} className="mt-2 flex items-center justify-center gap-2 rounded-2xl bg-[var(--ink)] p-3.5 text-[15px] font-bold text-white shadow-md active:scale-95 transition-all">
              <User size={18} /> Patient Portal Login
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   Desktop Bento Panel
   ───────────────────────────────────────────────────────────────────────── */
function CarePanel({ area, onNavigate }: { area: CareArea; onNavigate: () => void }) {
  const depts = deptsOf(area);
  const multi = depts.length > 1;
  const consultants = depts.flatMap((d) => doctorsOf(d.name));

  return (
    <div className="grid grid-cols-[280px_1fr] gap-2 p-1">
      {/* ── Left Info Bento ── */}
      <aside className="flex flex-col justify-between rounded-[20px] bg-[var(--teal-soft)] p-5 ring-1 ring-[var(--teal)]/20">
        <div>
          <span className="grid h-14 w-14 place-items-center rounded-2xl bg-[var(--teal)]/10 text-white shadow-md">
            <DeptIcon name={area.departments[0]} className="h-8 w-8" />
          </span>
          <h3 className="mt-4 text-[22px] font-bold leading-tight text-[var(--ink)]">{area.label}</h3>
          <p className="mt-2 text-[13px] font-medium leading-relaxed text-[var(--ink-soft)]">{area.blurb}</p>
        </div>

        {consultants.length > 0 && (
          <div className="mt-6 flex flex-col gap-2">
            <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-[var(--teal)]" style={{ fontFamily: "var(--font-mono)" }}>
              {consultants.length === 1 ? "Consultant" : "Consultants"}
            </p>
            <div className="flex flex-col gap-2">
              {consultants.map((doc) => (
                <Link key={doc.id} href={`/doctors/${doc.id}`} onClick={onNavigate}
                  className="group flex items-center gap-3 rounded-2xl bg-white p-2.5 shadow-sm ring-1 ring-[var(--line)] transition-all hover:ring-[var(--teal)] hover:shadow-md">
                  <span className="h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-[var(--bone)]">
                    <DoctorAvatar name={doc.name} image={doc.image} className="h-full w-full object-cover text-[10px]" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-bold text-[var(--ink)]">{doc.name}</span>
                    <span className="block truncate text-[11px] font-semibold text-[var(--teal)]">{doc.specialization}</span>
                  </span>
                  <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[var(--bone)] text-[var(--muted)] transition-colors group-hover:bg-[var(--teal)] group-hover:text-white">
                    <ArrowRight size={14} />
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}
      </aside>

      {/* ── Right Services Bento ── */}
      <div className="rounded-[20px] bg-[var(--bone)]/50 p-6 ring-1 ring-[var(--line)]">
        <div className={multi ? "grid grid-cols-2 gap-8" : "max-w-3xl"}>
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
    <div className="flex flex-col h-full">
      <div className="mb-4 flex items-center justify-between gap-3 border-b-2 border-[var(--line)] pb-3">
        <h4 className="text-[12px] font-bold uppercase tracking-[0.15em] text-[var(--ink)]" style={{ fontFamily: "var(--font-mono)" }}>
          {dept.name}
        </h4>
        <Link href={`/book?dept=${encodeURIComponent(dept.name)}`} onClick={onNavigate}
          className="shrink-0 rounded-lg bg-[var(--teal)] px-3 py-1.5 text-[11px] font-bold text-white shadow-sm transition-all hover:bg-[var(--teal-deep)] active:scale-95">
          Book Appt
        </Link>
      </div>
      
      <ul className={`gap-x-8 gap-y-2 ${newspaper ? "columns-2 lg:columns-3" : "flex flex-col"}`}>
        {dept.services.map((s) => (
          <li key={s.name} className="break-inside-avoid mb-1">
            <Link href={serviceHref(dept.name)} onClick={onNavigate} title={s.desc}
              className="group flex items-center gap-2 rounded-xl px-2 py-1.5 transition-colors hover:bg-white hover:shadow-sm hover:ring-1 hover:ring-[var(--line)]">
              <div className="h-1.5 w-1.5 rounded-full bg-[var(--teal)]/40 transition-colors group-hover:bg-[var(--teal)]" />
              <span className="text-[14px] font-medium leading-snug text-[var(--ink-soft)] transition-colors group-hover:text-[var(--teal)]">
                {s.name}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
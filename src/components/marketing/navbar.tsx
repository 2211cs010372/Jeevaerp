"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Search, PhoneCall, User, Menu, X, ChevronDown, ArrowRight } from "lucide-react";
import { DeptIcon } from "@/components/marketing/dept-icon";
import { DoctorAvatar } from "@/components/marketing/doctor-avatar";
import { HOSPITAL, DEPARTMENTS, DOCTORS } from "@/lib/data";

/**
 * Informative two-row navbar (Rainbow-hospital style, in pine/porcelain):
 *   Row 1 — wordmark + tagline · search · appointment + emergency lines · login.
 *   Row 2 — Departments ▾ / Doctors ▾ / plain links, with full-width mega-menus.
 * The Departments mega-menu shows the RELATED doctors for the hovered
 * department; every item is a real link into /book (by dept or by doctor).
 */

type Menu = "departments" | "doctors" | null;
const doctorsFor = (dept: string) => DOCTORS.filter((d) => d.department === dept);

const NAV: { label: string; menu?: Menu; href?: string }[] = [
  { label: "Departments", menu: "departments" },
  { label: "Doctors", menu: "doctors" },
  { label: "Rooms & prices", href: "/#wards" },
  { label: "Visit us", href: "/#visit" },
  { label: "FAQ", href: "/#faq" },
];

export function Navbar() {
  const router = useRouter();
  const [menu, setMenu] = useState<Menu>(null);
  const [activeDept, setActiveDept] = useState(DEPARTMENTS[0].name);
  const [open, setOpen] = useState(false);
  const [mobileSection, setMobileSection] = useState<Menu>(null);
  const [q, setQ] = useState("");

  const phone = HOSPITAL.phone.replace(/\s/g, "");
  const emergency = HOSPITAL.emergency.replace(/\s/g, "");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setMenu(null); setOpen(false); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function submitSearch(e: FormEvent) {
    e.preventDefault();
    router.push(q.trim() ? `/doctors?q=${encodeURIComponent(q.trim())}` : "/doctors");
    setOpen(false);
  }
  const close = () => { setMenu(null); setOpen(false); };

  return (
    <header className="fixed inset-x-0 top-0 z-50 bg-[var(--paper)] shadow-[var(--shadow-sm)]">
      {/* ── Row 1 — brand · search · actions ─────────────────────── */}
      <div className="border-b border-[var(--line)]">
        <div className="mx-auto flex max-w-[1280px] items-center gap-3 px-4 py-2.5 sm:gap-4 sm:px-5">
          <Link href="/" className="flex shrink-0 items-center gap-2.5" aria-label="Jeeva — home" onClick={close}>
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-[var(--teal)] text-white" aria-hidden>
              <svg width="13" height="13" viewBox="0 0 14 14"><path d="M5 0h4v5h5v4H9v5H5V9H0V5h5z" fill="currentColor" /></svg>
            </span>
            <span className="leading-none">
              <span className="display block text-[19px] text-[var(--ink)]">Jeeva</span>
              <span className="mt-0.5 hidden text-[8.5px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)] sm:block" style={{ fontFamily: "var(--font-mono)" }}>Multispeciality · Diagnostics · Pharmacy</span>
            </span>
          </Link>

          <form onSubmit={submitSearch} className="relative mx-auto hidden max-w-[440px] flex-1 md:block">
            <Search size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search doctors, specialities…"
              className="w-full rounded-full border border-[var(--line-strong)] bg-[var(--bone)] py-2.5 pl-9 pr-11 text-[13px] text-[var(--ink)] outline-none transition-colors placeholder:text-[var(--muted)] focus:border-[var(--teal)] focus:bg-white" />
            <button type="submit" aria-label="Search" className="absolute right-1 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full bg-[var(--teal)] text-white transition-colors hover:bg-[var(--teal-deep)]">
              <Search size={14} />
            </button>
          </form>

          <div className="flex shrink-0 items-center gap-2">
            <a href={`tel:${phone}`} className="hidden items-center gap-2 rounded-full border border-[var(--line-strong)] px-2.5 py-1.5 transition-colors hover:border-[var(--teal)] lg:inline-flex">
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

      {/* ── Row 2 — nav + mega-menus (desktop) ───────────────────── */}
      <div className="relative hidden lg:block" onMouseLeave={() => setMenu(null)}>
        <div className="mx-auto flex max-w-[1280px] items-center gap-1 px-5">
          {NAV.map((item) => item.menu ? (
            <button key={item.label} onMouseEnter={() => setMenu(item.menu!)}
              aria-expanded={menu === item.menu}
              className={`flex items-center gap-1.5 border-b-2 px-4 py-2.5 text-[13.5px] font-medium transition-colors ${menu === item.menu ? "border-[var(--teal)] text-[var(--teal)]" : "border-transparent text-[var(--ink-soft)] hover:text-[var(--teal)]"}`}>
              {item.label} <ChevronDown size={13} className={`transition-transform ${menu === item.menu ? "rotate-180" : ""}`} />
            </button>
          ) : (
            <Link key={item.label} href={item.href!} onMouseEnter={() => setMenu(null)} onClick={close}
              className="border-b-2 border-transparent px-4 py-2.5 text-[13.5px] font-medium text-[var(--ink-soft)] transition-colors hover:text-[var(--teal)]">
              {item.label}
            </Link>
          ))}
        </div>

        {menu && (
          <div className="mega-in absolute inset-x-0 top-full border-b border-[var(--line)] bg-[var(--paper)] shadow-[var(--shadow)]">
            <div className="mx-auto max-w-[1280px] px-5 py-5">
              {menu === "departments" && (
                <div className="grid grid-cols-[1.1fr_0.9fr] gap-6">
                  <div>
                    <div className="mb-3 flex items-center justify-between">
                      <p className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-[var(--muted)]" style={{ fontFamily: "var(--font-mono)" }}>{DEPARTMENTS.length} departments · one building</p>
                      <Link href="/#departments" onClick={close} className="text-[12.5px] font-semibold text-[var(--teal)]">What we treat →</Link>
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                      {DEPARTMENTS.map((d) => (
                        <Link key={d.name} href={`/book?dept=${encodeURIComponent(d.name)}`} onMouseEnter={() => setActiveDept(d.name)} onClick={close}
                          className={`flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors ${activeDept === d.name ? "bg-[var(--teal-soft)]" : "hover:bg-[var(--bone)]"}`}>
                          <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg transition-colors ${activeDept === d.name ? "bg-[var(--teal)] text-white" : "bg-[var(--bone)] text-[var(--teal)]"}`}><DeptIcon name={d.name} className="h-5 w-5" /></span>
                          <span className="min-w-0">
                            <span className="block truncate text-[13px] font-semibold text-[var(--ink)]">{d.name}</span>
                            <span className="block truncate text-[9.5px] uppercase tracking-wide text-[var(--muted)]" style={{ fontFamily: "var(--font-mono)" }}>{d.common}</span>
                          </span>
                        </Link>
                      ))}
                    </div>
                  </div>

                  {/* related doctors for the hovered department */}
                  <div className="rounded-2xl border border-[var(--line)] bg-[var(--bone)] p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <p className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-[var(--teal)]" style={{ fontFamily: "var(--font-mono)" }}>Consultants · {activeDept}</p>
                      <Link href={`/book?dept=${encodeURIComponent(activeDept)}`} onClick={close} className="text-[12px] font-semibold text-[var(--teal)]">Book →</Link>
                    </div>
                    <div className="space-y-2">
                      {doctorsFor(activeDept).length === 0 ? (
                        <p className="rounded-xl bg-white p-4 text-center text-[12.5px] text-[var(--muted)]">Consultant details are available at the front desk — or book and we&apos;ll assign the right specialist.</p>
                      ) : doctorsFor(activeDept).map((doc) => (
                        <Link key={doc.id} href={`/book?doctor=${doc.id}`} onClick={close}
                          className="group flex items-center gap-3 rounded-xl bg-white p-2.5 shadow-[var(--shadow-sm)] transition-shadow hover:shadow-[var(--shadow)]">
                          <span className="h-11 w-11 shrink-0 overflow-hidden rounded-full ring-1 ring-[var(--line)]"><DoctorAvatar name={doc.name} image={doc.image} className="h-full w-full rounded-full text-[13px]" /></span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] font-semibold text-[var(--ink)]">{doc.name}</span>
                            <span className="block truncate text-[11.5px] text-[var(--teal)]">{doc.specialization}</span>
                            <span className="mt-0.5 block text-[10px] text-[var(--muted)]" style={{ fontFamily: "var(--font-mono)" }}>{doc.days} · {doc.opd} · ₹{doc.fee}</span>
                          </span>
                          <ArrowRight size={15} className="shrink-0 text-[var(--muted)] transition-colors group-hover:text-[var(--teal)]" />
                        </Link>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {menu === "doctors" && (
                <div>
                  <div className="mb-3 flex items-center justify-between">
                    <p className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-[var(--muted)]" style={{ fontFamily: "var(--font-mono)" }}>{DOCTORS.length} specialists · consulting daily</p>
                    <Link href="/doctors" onClick={close} className="text-[12.5px] font-semibold text-[var(--teal)]">All doctors →</Link>
                  </div>
                  <div className="grid grid-cols-4 gap-2.5">
                    {DOCTORS.map((doc) => (
                      <Link key={doc.id} href={`/book?doctor=${doc.id}`} onClick={close}
                        className="group rounded-2xl border border-[var(--line)] p-3 transition-all hover:border-[var(--teal-tint)] hover:shadow-[var(--shadow)]">
                        <div className="flex items-center gap-2.5">
                          <span className="h-11 w-11 shrink-0 overflow-hidden rounded-full ring-1 ring-[var(--line)]"><DoctorAvatar name={doc.name} image={doc.image} className="h-full w-full rounded-full text-[13px]" /></span>
                          <span className="min-w-0">
                            <span className="block truncate text-[12.5px] font-semibold text-[var(--ink)]">{doc.name}</span>
                            <span className="block truncate text-[11px] text-[var(--teal)]">{doc.specialization}</span>
                          </span>
                        </div>
                        <div className="mt-2.5 flex items-center justify-between border-t border-[var(--line)] pt-2">
                          <span className="text-[10px] text-[var(--muted)]" style={{ fontFamily: "var(--font-mono)" }}>{doc.department}</span>
                          <span className="rounded-full bg-[var(--teal-soft)] px-2 py-0.5 text-[11px] font-semibold text-[var(--teal-deep)] transition-colors group-hover:bg-[var(--teal)] group-hover:text-white" style={{ fontFamily: "var(--font-mono)" }}>₹{doc.fee}</span>
                        </div>
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── mobile drawer ────────────────────────────────────────── */}
      {open && (
        <div className="max-h-[calc(100vh-58px)] overflow-y-auto border-t border-[var(--line)] bg-[var(--paper)] lg:hidden">
          <div className="space-y-3 px-4 py-3">
            <form onSubmit={submitSearch} className="relative">
              <Search size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search doctors, specialities…"
                className="w-full rounded-full border border-[var(--line-strong)] bg-[var(--bone)] py-2.5 pl-9 pr-4 text-[13px] text-[var(--ink)] outline-none focus:border-[var(--teal)] focus:bg-white" />
            </form>

            {(["departments", "doctors"] as const).map((sec) => (
              <div key={sec} className="rounded-xl border border-[var(--line)]">
                <button onClick={() => setMobileSection((s) => (s === sec ? null : sec))} aria-expanded={mobileSection === sec}
                  className="flex w-full items-center justify-between px-4 py-3 text-[14px] font-semibold capitalize text-[var(--ink)]">
                  {sec}
                  <ChevronDown size={15} className={`transition-transform ${mobileSection === sec ? "rotate-180" : ""}`} />
                </button>
                {mobileSection === sec && (
                  <div className="border-t border-[var(--line)] p-2">
                    {sec === "departments" ? (
                      <div className="grid grid-cols-2 gap-1.5">
                        {DEPARTMENTS.map((d) => (
                          <Link key={d.name} href={`/book?dept=${encodeURIComponent(d.name)}`} onClick={close}
                            className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-[12.5px] font-medium text-[var(--ink-soft)] hover:bg-[var(--teal-soft)] hover:text-[var(--teal)]">
                            <DeptIcon name={d.name} className="h-4 w-4 text-[var(--teal)]" /> {d.name}
                          </Link>
                        ))}
                      </div>
                    ) : (
                      <div className="space-y-1">
                        {DOCTORS.map((doc) => (
                          <Link key={doc.id} href={`/book?doctor=${doc.id}`} onClick={close} className="flex items-center gap-2.5 rounded-lg px-2 py-2 hover:bg-[var(--teal-soft)]">
                            <span className="h-8 w-8 shrink-0 overflow-hidden rounded-full"><DoctorAvatar name={doc.name} image={doc.image} className="h-full w-full rounded-full text-[11px]" /></span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[12.5px] font-semibold text-[var(--ink)]">{doc.name}</span>
                              <span className="block truncate text-[10.5px] text-[var(--teal)]">{doc.specialization}</span>
                            </span>
                            <span className="text-[11px] font-semibold text-[var(--muted)]" style={{ fontFamily: "var(--font-mono)" }}>₹{doc.fee}</span>
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}

            {NAV.filter((n) => n.href).map((n) => (
              <Link key={n.label} href={n.href!} onClick={close} className="block border-b border-[var(--line)] px-1 py-2.5 text-[14px] font-medium text-[var(--ink-soft)]">{n.label}</Link>
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

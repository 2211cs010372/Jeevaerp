"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { MapPin, Clock, Mail, User, Menu, X, ArrowRight } from "lucide-react";
import { HOSPITAL } from "@/lib/data";

/**
 * Navbar — deliberately simple. Two tiers:
 *   1. a dark-pine utility strip carrying the facts people scan for (where,
 *      when, how to reach emergency) — the "informative" line;
 *   2. a clean porcelain bar: wordmark, plain links, a small Login button and
 *      the Book CTA. No mega-menus, no magnetic tricks — just a calm header
 *      in the same pine/porcelain language as the rest of the site.
 */

const LINKS = [
  { href: "/#departments", label: "Departments" },
  { href: "/doctors", label: "Doctors" },
  { href: "/#wards", label: "Rooms & prices" },
  { href: "/#visit", label: "Visit us" },
  { href: "/#faq", label: "FAQ" },
];

export function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const emergency = HOSPITAL.emergency.replace(/\s/g, "");

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 6);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <header className="fixed inset-x-0 top-0 z-50">
      {/* ── utility strip — the informative line ── */}
      <div className="hidden bg-[var(--pine-ink)] text-white md:block">
        <div
          className="mx-auto flex max-w-[1240px] items-center justify-between gap-4 px-5 py-1.5 text-[11.5px]"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          <div className="flex items-center gap-5 text-white/65">
            <span className="inline-flex items-center gap-1.5">
              <MapPin size={13} className="text-[var(--teal-tint)]" /> {HOSPITAL.locality}
            </span>
            <span className="hidden items-center gap-1.5 lg:inline-flex">
              <Clock size={13} className="text-[var(--teal-tint)]" /> OPD {HOSPITAL.opdHours} · {HOSPITAL.opdDays}
            </span>
          </div>
          <div className="flex items-center gap-5">
            <a href={`mailto:${HOSPITAL.email}`} className="hidden items-center gap-1.5 text-white/65 transition-colors hover:text-white lg:inline-flex">
              <Mail size={13} /> {HOSPITAL.email}
            </a>
            <a href={`tel:${emergency}`} className="inline-flex items-center gap-1.5 font-semibold text-[#ff9c8a] transition-colors hover:text-[#ffb6a6]">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#ff9c8a]" aria-hidden /> Emergency 24×7 · {HOSPITAL.emergency}
            </a>
          </div>
        </div>
      </div>

      {/* ── main bar ── */}
      <div className={`border-b border-[var(--line)] transition-all duration-300 ${scrolled ? "bg-[var(--paper)]/90 shadow-[var(--shadow-sm)] backdrop-blur-md" : "bg-[var(--paper)]"}`}>
        <div className="mx-auto flex h-[60px] max-w-[1240px] items-center justify-between gap-4 px-4 sm:px-5">
          <Link href="/" className="flex items-center gap-2.5" aria-label="Jeeva — home" onClick={() => setOpen(false)}>
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-[var(--teal)] text-white" aria-hidden>
              <svg width="12" height="12" viewBox="0 0 14 14"><path d="M5 0h4v5h5v4H9v5H5V9H0V5h5z" fill="currentColor" /></svg>
            </span>
            <span className="display text-[20px] leading-none text-[var(--ink)]">Jeeva</span>
          </Link>

          <nav className="hidden items-center gap-7 lg:flex">
            {LINKS.map((l) => (
              <Link key={l.href} href={l.href} className="text-[14px] font-medium text-[var(--ink-soft)] transition-colors hover:text-[var(--teal)]">
                {l.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <Link
              href="/portal/login"
              className="inline-flex items-center gap-1.5 rounded-full border border-[var(--line-strong)] px-3.5 py-1.5 text-[13px] font-semibold text-[var(--ink)] transition-colors hover:border-[var(--teal)] hover:text-[var(--teal)]"
            >
              <User size={14} /> Login
            </Link>
            <Link
              href="/book"
              className="hidden items-center gap-1.5 rounded-full bg-[var(--ink)] px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-black sm:inline-flex"
            >
              Book appointment <ArrowRight size={14} />
            </Link>
            <button
              onClick={() => setOpen((v) => !v)}
              aria-label={open ? "Close menu" : "Open menu"}
              aria-expanded={open}
              className="grid h-9 w-9 place-items-center rounded-full border border-[var(--line-strong)] text-[var(--ink)] lg:hidden"
            >
              {open ? <X size={16} /> : <Menu size={16} />}
            </button>
          </div>
        </div>
      </div>

      {/* ── mobile drawer ── */}
      {open && (
        <div className="border-b border-[var(--line)] bg-[var(--paper)] shadow-[var(--shadow)] lg:hidden">
          <nav className="mx-auto flex max-w-[1240px] flex-col px-4 py-1">
            {LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="flex items-center justify-between border-b border-[var(--line)] py-3.5 text-[15px] font-medium text-[var(--ink-soft)] last:border-0"
              >
                {l.label}
                <ArrowRight size={15} className="text-[var(--muted)]" />
              </Link>
            ))}
            <div className="flex items-center gap-2 py-3">
              <Link href="/portal/login" onClick={() => setOpen(false)} className="flex flex-1 items-center justify-center gap-1.5 rounded-full border border-[var(--line-strong)] py-2.5 text-[14px] font-semibold text-[var(--ink)]">
                <User size={15} /> Login
              </Link>
              <Link href="/book" onClick={() => setOpen(false)} className="flex flex-1 items-center justify-center gap-1.5 rounded-full bg-[var(--ink)] py-2.5 text-[14px] font-semibold text-white">
                Book appointment
              </Link>
            </div>
            <a href={`tel:${emergency}`} className="mb-2 flex items-center justify-center gap-2 rounded-full bg-[var(--alert-soft)] py-2.5 text-[13px] font-semibold text-[var(--alert)]">
              Emergency 24×7 · {HOSPITAL.emergency}
            </a>
          </nav>
        </div>
      )}
    </header>
  );
}

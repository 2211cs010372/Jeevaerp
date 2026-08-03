"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { PhoneCall, User, ChevronDown, ArrowRight, ArrowUpRight } from "lucide-react";
import { DeptIcon } from "@/components/marketing/dept-icon";
import { MenuIcon } from "@/components/marketing/menu-icon";
import { DoctorSearchBox } from "@/components/marketing/doctor-search-box";
import { DoctorAvatar } from "@/components/marketing/doctor-avatar";
import { HOSPITAL, DEPARTMENTS, DOCTORS, CARE_AREAS, type CareArea, type Department } from "@/lib/data";
import { careHref } from "@/lib/care";
import { doctorHref } from "@/lib/doctors";
import { api } from "@/lib/api-client";

/**
 * Three-tier navbar with care-area mega-menus.
 *
 *   Strip  - live OPD status · emergency line. Retracts on scroll.
 *   Row 1  - wordmark · search · appointment + emergency lines · login.
 *   Row 2  - Child Care / Women Care / Heart Care / … each opening a full-width
 *            panel listing EVERYTHING that care area covers.
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
 *
 * The shell is solid porcelain at rest - the hero's top band is the same
 * colour, so header and hero read as one surface - and becomes glass with a
 * hairline once the page has moved. The status strip retracts at the same
 * moment, which is what buys the condensed height.
 *
 * DRAWN IN VALUE STEPS, NOT HAIRLINES. The chrome used to separate itself with
 * 1px rules and outline every control in a bordered pill; the rest of the site
 * had already moved to flat panels that are told apart by the step between
 * paper and bone. So the care-area rail is a bone band rather than a ruled
 * one, and the controls beside the wordmark - phone, login, menu - are bone
 * fills that deepen on hover instead of rings that change colour. The pine
 * status strip and the pill CTAs are untouched: pills are the site's button
 * language everywhere (see `.btn` in site-theme.css), and a button that stops
 * looking like every other button on the site to match a panel is a trade in
 * the wrong direction.
 *
 * WHERE A HAIRLINE COMES OFF, ITS BOX STAYS. Row 1's rule is transparent now
 * rather than absent, because `--nav-h` is a hand-written token that pages
 * offset their first section from - the header measured 141px before this
 * change and measures 141px after it. The same trick the shell itself uses at
 * rest, two dozen lines down.
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

/**
 * OPD runs 08:00-20:00 on the days HOSPITAL.opdDays lists. The emergency
 * department never closes.
 *
 * The day check is the point: this used to test the clock only, so at 10am on a
 * Sunday - the one day there is no routine consulting - the strip told visitors
 * "OPD open now". A status pill that is wrong is worse than no status pill.
 */
function opdState(now: Date) {
  const mins = now.getHours() * 60 + now.getMinutes();
  const [from, to] = HOSPITAL.opdHours.split("–").map((s) => s.trim());
  const closedToday = (HOSPITAL.opdClosedDays as readonly number[]).includes(now.getDay());
  const open = !closedToday && mins >= 8 * 60 && mins < 20 * 60;

  if (open) return { open, text: `OPD open now · closes ${to}` };
  if (closedToday) return { open, text: `OPD closed today · ${HOSPITAL.opdDays}` };
  return { open, text: `OPD closed · opens ${from}` };
}

export function Navbar() {
  const [menu, setMenu] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [mobileArea, setMobileArea] = useState<string | null>(null);
  const [stuck, setStuck] = useState(false);
  // Rendered only after mount: the server has no idea what time it is where
  // the visitor is, and a hydration mismatch on the first paint of a hospital
  // homepage is not worth a status pill.
  const [opd, setOpd] = useState<ReturnType<typeof opdState> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  /** Has the drawer ever been opened? Guards the focus return below. */
  const used = useRef(false);

  const phone = HOSPITAL.phone.replace(/\s/g, "");
  const emergency = HOSPITAL.emergency.replace(/\s/g, "");

  useEffect(() => {
    setOpd(opdState(new Date()));
    const tick = setInterval(() => setOpd(opdState(new Date())), 60_000);
    return () => clearInterval(tick);
  }, []);

  /**
   * The hospital's own logo, as uploaded by an admin under Settings.
   *
   * Same source the portal shells and the sign-in screens read - one
   * unauthenticated endpoint over HospitalConfig, so a hospital that uploads a
   * logo gets it on the public site and both portals without touching code.
   * Only the logo is used here; the wordmark beside it stays on lib/data.ts,
   * for the reason given where it is set.
   * Fetched after mount rather than server-rendered: this header is on every
   * public page, and blocking their render on a database round-trip to draw a
   * 36px mark is the wrong trade. Until it lands - and forever, if no logo has
   * been uploaded or the request fails - the built-in teal mark stands in, so
   * there is never a gap where the brand should be.
   */
  const [brand, setBrand] = useState<{
    brandName: string;
    logoDataUrl: string | null;
  } | null>(null);

  useEffect(() => {
    api
      .get<{ brandName: string; logoDataUrl: string | null }>("/public/branding")
      .then(setBrand)
      .catch(() => {});
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setMenu(null); setOpen(false); } };
    const onScroll = () => setStuck(window.scrollY > 24);
    onScroll();
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  /**
   * While the drawer is open the page behind it must not scroll. Without this,
   * a thumb landing on the scrim - the natural way to dismiss a drawer - drags
   * the homepage instead, and the menu you were reading is now floating over
   * a different part of the site.
   *
   * Locking `body` rather than calling into Lenis on purpose: Lenis is mounted
   * on the public site only, and the navbar has to behave the same either way.
   */
  useEffect(() => {
    if (!open) return;
    const prior = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prior;
    };
  }, [open]);

  /** Focus into the drawer on open, and back onto the toggle on close - but
   *  never on first render, where nothing has been opened to return from. */
  useEffect(() => {
    if (open) {
      used.current = true;
      closeRef.current?.focus();
    } else if (used.current) {
      toggleRef.current?.focus();
    }
  }, [open]);

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
    <>
    <header
      data-stuck={stuck}
      className={`fixed inset-x-0 top-0 z-50 transition-[background-color,box-shadow,border-color] duration-500 ${
        stuck
          ? "border-b border-[var(--line)] bg-[var(--paper)]/85 shadow-[0_10px_40px_-24px_rgba(11,32,29,0.35)] backdrop-blur-xl backdrop-saturate-150"
          : "border-b border-transparent bg-[var(--paper)]"
      }`}
    >
      {/* ── status strip - retracts once the page has moved ───────── */}
      <div
        className="overflow-hidden bg-[var(--pine-ink)] text-white transition-[height,opacity] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]"
        style={{ height: stuck ? 0 : 32, opacity: stuck ? 0 : 1 }}
        aria-hidden={stuck}
      >
        <div className="mx-auto flex h-8 max-w-[1320px] items-center justify-between gap-4 px-4 sm:px-6">
          <span className="mono flex min-w-0 items-center gap-2.5 text-[10.5px] tracking-[0.1em]">
            <span className={`pulse ${opd && !opd.open ? "pulse-alert" : ""}`} />
            <span className="truncate text-white/80">
              {/* the pre-hydration fallback said "seven days" while the data
                  said Monday to Saturday - read it, do not retype it */}
              {opd ? opd.text : `OPD ${HOSPITAL.opdHours} · ${HOSPITAL.opdDays}`}
            </span>
          </span>
          <a
            href={`tel:${emergency}`}
            className="mono flex shrink-0 items-center gap-2 text-[10.5px] tracking-[0.1em] text-white/80 transition-colors hover:text-white"
          >
            <span className="hidden uppercase sm:inline">Emergency 24×7</span>
            <span className="font-semibold text-white">{HOSPITAL.emergency}</span>
          </a>
        </div>
      </div>

      {/* ── Row 1 - brand · search · actions ─────────────────────── */}
      <div className={stuck ? "" : "border-b border-transparent"}>
        <div className="mx-auto flex max-w-[1320px] items-center gap-3 px-4 py-2.5 sm:gap-4 sm:px-6">
          <Link href="/" className="group flex shrink-0 items-center gap-2.5" aria-label="Jeeva - home" onClick={close}>
            {brand?.logoDataUrl ? (
              /* A plain <img>, as in the portal shell: the source is a base64
                 data URI out of the database, so there is nothing for the image
                 optimiser to fetch or resize - it would only add a proxy hop to
                 bytes we already hold. `object-contain` because an uploaded
                 logo is whatever shape it is, and no hover rotation: spinning
                 the built-in glyph is a nice touch, spinning somebody's actual
                 logotype is vandalism. */
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={brand.logoDataUrl}
                alt=""
                className="h-9 w-9 shrink-0 rounded-[11px] object-contain"
              />
            ) : (
              <span className="grid h-9 w-9 place-items-center rounded-[11px] bg-[var(--teal)] text-white transition-transform duration-500 group-hover:rotate-90" aria-hidden>
                <svg width="13" height="13" viewBox="0 0 14 14"><path d="M5 0h4v5h5v4H9v5H5V9H0V5h5z" fill="currentColor" /></svg>
              </span>
            )}
            <span className="leading-none">
              {/* THE WORDMARK IS NOT THE BRAND NAME FROM SETTINGS, deliberately.
                  That field currently holds "Jeeva Multi Speciality Hospital" -
                  31 characters where this sets five at 20px display, which on a
                  phone wraps to a second line and takes the header's height
                  with it. The public site's copy comes from lib/data.ts by
                  design; the Settings record drives the logo and the portals. */}
              <span className="display block text-[20px] tracking-[-0.04em] text-[var(--ink)]">Jeeva</span>
              <span className="mono mt-1 hidden text-[8px] uppercase tracking-[0.16em] text-[var(--muted)] sm:block">Multispeciality · Diagnostics · Pharmacy</span>
            </span>
          </Link>

          <DoctorSearchBox onNavigate={close} />

          {/* `ml-auto` is load-bearing below `md`. The search box is the only
              flexible child in this row, and it is display:none on a phone -
              so with nothing left to take up the slack the actions packed in
              against the wordmark and the menu button sat beside the logo with
              160px of empty header to the right of it. At `md` and up the
              search box's own `flex-1` has already eaten the free space, so
              this changes nothing there. */}
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {/* two lines of information rather than a control, so it takes the
                panel shape - 10px outer, 8px inner frame, the doctor card's
                proportions at a quarter of the size */}
            <a href={`tel:${phone}`} className="hidden items-center gap-2 rounded-[10px] bg-[var(--bone)] px-2.5 py-1.5 transition-colors duration-300 hover:bg-[var(--bone-deep)] xl:inline-flex">
              <span className="grid h-7 w-7 place-items-center rounded-[8px] bg-[var(--teal-soft)] text-[var(--teal)]"><PhoneCall size={13} /></span>
              <span className="leading-tight">
                <span className="mono block text-[8px] uppercase tracking-[0.14em] text-[var(--muted)]">For appointment</span>
                <span className="mono block text-[12.5px] font-bold text-[var(--ink)]">{HOSPITAL.phone}</span>
              </span>
            </a>
            <Link
              href="/book"
              onClick={close}
              className="hidden items-center gap-1.5 rounded-full bg-[var(--ink)] px-4 py-2.5 text-[13px] font-semibold text-white transition-colors hover:bg-black sm:inline-flex"
            >
              Book <ArrowUpRight size={14} />
            </Link>
            <Link href="/portal/login" aria-label="Patient login" className="grid h-9 w-9 place-items-center rounded-full bg-[var(--bone)] text-[var(--ink)] transition-colors duration-300 hover:bg-[var(--bone-deep)] hover:text-[var(--teal)]" onClick={close}>
              <User size={16} />
            </Link>
            <button
              ref={toggleRef}
              onClick={() => setOpen((v) => !v)}
              aria-label={open ? "Close menu" : "Open menu"}
              aria-expanded={open}
              aria-controls="mobile-drawer"
              className="grid h-9 w-9 place-items-center rounded-full bg-[var(--bone)] text-[var(--ink)] transition-colors duration-300 hover:bg-[var(--bone-deep)] hover:text-[var(--teal)] lg:hidden"
            >
              <MenuIcon open={open} />
            </button>
          </div>
        </div>
      </div>

      {/* ── Row 2 - care areas + mega-menus (desktop) ──────────────
          The bone band IS the separation from row 1 - it replaces the hairline
          that used to run between them. It comes off once the header is stuck,
          because a solid strip under a glass one reads as two headers rather
          than one: scrolled, the whole shell is the same frosted surface. */}
      <div
        className={`relative hidden lg:block ${stuck ? "" : "bg-[var(--bone)]"}`}
        onMouseLeave={release}
      >
        {/* Scrolls rather than overflows. Row 2 appears at exactly lg, which is
            the width where its ten items do NOT fit: at 1024px the content ran
            1219px wide inside a 1009px container, clipped "Visit us" off the
            end and dragged the whole document into horizontal scroll. Tighter
            padding at lg gets most of it back; the scroll catches the rest. */}
        <div className="nav-rail mx-auto flex max-w-[1320px] items-center overflow-x-auto px-4 xl:px-6">
          {CARE_AREAS.map((area) => {
            const on = menu === area.label;
            return (
              <button
                key={area.label}
                onMouseEnter={() => hold(area.label)}
                onClick={() => setMenu(on ? null : area.label)}
                aria-expanded={on}
                aria-haspopup="true"
                className={`relative flex shrink-0 items-center gap-1.5 px-2.5 py-3 text-[13.5px] font-medium tracking-[-0.01em] transition-colors xl:px-3.5 xl:text-[14.5px] ${
                  on ? "text-[var(--teal)]" : "text-[var(--ink-soft)] hover:text-[var(--teal)]"
                }`}
              >
                {area.label}
                <ChevronDown size={12} className={`transition-transform duration-300 ${on ? "rotate-180" : ""}`} />
                <span
                  className={`absolute inset-x-2.5 bottom-0 h-[2px] origin-left bg-[var(--teal)] transition-transform duration-400 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                    on ? "scale-x-100" : "scale-x-0"
                  }`}
                />
              </button>
            );
          })}

          <span className="mx-3 h-3.5 w-px shrink-0 bg-[var(--line-strong)]" aria-hidden />

          {LINKS.map((l) => (
            <Link key={l.label} href={l.href} onMouseEnter={release} onClick={close}
              className="group relative shrink-0 whitespace-nowrap px-2.5 py-3 text-[13.5px] font-medium tracking-[-0.01em] text-[var(--ink-soft)] transition-colors hover:text-[var(--teal)] xl:px-3.5 xl:text-[14.5px]">
              {l.label}
              <span className="absolute inset-x-2.5 bottom-0 h-[2px] origin-left scale-x-0 bg-[var(--teal)] transition-transform duration-400 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-x-100" />
            </Link>
          ))}
        </div>

        {menu && (
          /* No rules top or bottom: the panel is paper dropping out of a bone
             band, which is already a step, and the lift shadow is what says it
             is floating. Shadows are out on inline cards, not on things that
             hover over the page. */
          <div
            className="mega-in absolute inset-x-0 top-full bg-[var(--paper)] shadow-[var(--shadow-lift)]"
            onMouseEnter={() => hold(menu)}
          >
            <CarePanel area={CARE_AREAS.find((a) => a.label === menu)!} onNavigate={close} />
          </div>
        )}
      </div>

      </header>

      {/* ── mobile drawer ──────────────────────────────────────────────────
          A real drawer now, not a panel pushed out of the header. It used to
          be an accordion that unfolded downwards and was clipped to whatever
          height was left under the navbar - which on a small phone in landscape
          left the login button permanently below the fold. A panel anchored to
          the full height of the viewport has the whole screen to work with.

          MOUNTED ALWAYS, MOVED WITH A TRANSFORM. Rendering it only when open
          means it can animate in and never out - React removes the node before
          the transition can run. It stays in the tree, translated off-screen,
          and `inert` keeps its links out of the tab order and away from screen
          readers while it is closed.

          AND IT IS A SIBLING OF THE HEADER, NOT A CHILD OF IT. This is the
          whole reason the drawer used to vanish the moment you scrolled with
          it open. Past 24px the header becomes glass, and `backdrop-filter`
          makes an element a CONTAINING BLOCK for every `position: fixed`
          descendant - so the drawer stopped being fixed to the viewport and
          became fixed to the header instead. Measured: `inset-y-0` resolved to
          812px of viewport before the filter and 89px of header box after it,
          the scrim collapsing with it. Nothing about the drawer was wrong; it
          was being measured against the wrong box. Out here there is no
          filtered ancestor, so it is fixed to the viewport in both states.
          z-[60] still clears the header's z-50 - they are siblings in the root
          stacking context now, so the numbers compare directly. ──────────── */}
      <div className="lg:hidden">
        <div
          aria-hidden
          onClick={close}
          className={`fixed inset-0 z-[55] bg-[rgba(11,32,29,0.55)] backdrop-blur-[2px] transition-opacity duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${
            open ? "opacity-100" : "pointer-events-none opacity-0"
          }`}
        />

        <aside
          id="mobile-drawer"
          role="dialog"
          aria-modal={open || undefined}
          aria-label="Menu"
          inert={!open}
          className={`fixed inset-y-0 right-0 z-[60] flex w-[min(23rem,88vw)] flex-col bg-[var(--paper)] shadow-[var(--shadow-lift)] transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${
            open ? "translate-x-0" : "translate-x-full"
          }`}
        >
          {/* bone against the paper body below it - the drawer's own header
              separates the same way the care-area rail does upstairs */}
          <div className="flex flex-none w-full items-center justify-between gap-3 bg-[var(--bone)] px-4 py-3.5">
            <span className="min-w-0">
              <span className="display block text-[17px] leading-none text-[var(--ink)]">
                {HOSPITAL.shortName}
              </span>
              <span className="mono mt-1 block truncate text-[8.5px] uppercase tracking-[0.18em] text-[var(--muted)]">
                {HOSPITAL.locality}
              </span>
            </span>
            <button
              ref={closeRef}
              onClick={close}
              aria-label="Close menu"
              className="grid h-9 w-9 flex-none place-items-center rounded-full bg-[var(--paper)] text-[var(--ink)] transition-colors duration-300 hover:bg-[var(--bone-deep)] hover:text-[var(--teal)]"
            >
              <MenuIcon open />
            </button>
          </div>

          {/* `data-lenis-prevent` hands wheel and touch inside this box back to
              the browser. Lenis is a global listener that preventDefaults the
              gesture and scrolls the page virtually instead, which over an
              overlay means the drawer's own list will not move while the page
              behind it does. Lenis reads this attribute and skips the gesture
              entirely, so the drawer scrolls natively. Portals never see this -
              Lenis is mounted on the public site only. */}
          <div
            data-lenis-prevent
            className="drawer-scroll min-h-0 flex-1 overflow-y-auto"
          >
            <div className="space-y-3 px-4 py-4">
            <DoctorSearchBox variant="mobile" onNavigate={close} />

            {CARE_AREAS.map((area) => {
              const on = mobileArea === area.label;
              return (
                <div key={area.label} className="overflow-hidden rounded-[12px] bg-[var(--bone)]">
                  <button onClick={() => setMobileArea(on ? null : area.label)} aria-expanded={on}
                    className="flex w-full items-center gap-3 px-3.5 py-3.5 text-left">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[10px] bg-[var(--teal-soft)] text-[var(--teal)]">
                      <DeptIcon name={area.departments[0]} className="h-5 w-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[14.5px] font-semibold tracking-[-0.01em] text-[var(--ink)]">{area.label}</span>
                      <span className="block truncate text-[11.5px] text-[var(--muted)]">{area.blurb}</span>
                    </span>
                    <ChevronDown size={15} className={`shrink-0 transition-transform duration-300 ${on ? "rotate-180" : ""}`} />
                  </button>

                  {on && (
                    <div className="space-y-4 border-t border-[var(--line)] bg-[var(--bone-deep)] p-3">
                      {deptsOf(area).map((d) => (
                        <div key={d.name}>
                          <p className="mono mb-1.5 text-[9.5px] font-bold uppercase tracking-[0.16em] text-[var(--teal)]">
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

            {/* the same bone panel the care areas above are built from, so the
                drawer is one list of cells rather than cells then a ruled list */}
            {LINKS.map((l) => (
              <Link
                key={l.label}
                href={l.href}
                onClick={close}
                className="block rounded-[12px] bg-[var(--bone)] px-3.5 py-3.5 text-[14.5px] font-medium text-[var(--ink)] transition-colors duration-300 hover:bg-[var(--bone-deep)] hover:text-[var(--teal)]"
              >
                {l.label}
              </Link>
            ))}

            <div className="grid grid-cols-2 gap-2 pt-1">
              <a href={`tel:${phone}`} className="rounded-full border border-[var(--line-strong)] py-3 text-center text-[13px] font-semibold text-[var(--ink)]">Appointment</a>
              <a href={`tel:${emergency}`} className="rounded-full bg-[var(--alert-soft)] py-3 text-center text-[13px] font-semibold text-[var(--alert)]">Emergency 24×7</a>
            </div>
            <Link href="/book" onClick={close} className="flex items-center justify-center gap-1.5 rounded-full bg-[var(--ink)] py-3 text-[14px] font-semibold text-white">
              Book an appointment <ArrowUpRight size={15} />
            </Link>
            <Link href="/portal/login" onClick={close} className="flex items-center justify-center gap-1.5 rounded-full border border-[var(--line-strong)] py-3 text-[14px] font-semibold text-[var(--ink)]">
              <User size={15} /> Patient login
            </Link>
            </div>
          </div>
        </aside>
      </div>
    </>
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
    <div className="mx-auto max-w-[1320px] px-6 py-7">
      <div className="grid grid-cols-[248px_1fr] gap-8">
        {/* ---- what this area is ---- */}
        <aside className="rounded-[16px] bg-[var(--teal-soft)] p-5">
          <span className="grid h-16 w-16 place-items-center rounded-[10px] bg-[var(--teal)]/15 text-[var(--teal)]">
            <DeptIcon name={area.departments[0]} className="h-9 w-9" />
          </span>
          <p className="display-sm mt-4 text-[var(--ink)]">{area.label}</p>
          <p className="mt-2 text-[12.5px] leading-relaxed text-[var(--ink-soft)]">{area.blurb}</p>

          {consultants.length > 0 && (
            <div className="mt-5 space-y-1.5 border-t border-[var(--teal-tint)] pt-4">
              <p className="mono text-[9px] font-bold uppercase tracking-[0.18em] text-[var(--teal)]">
                {consultants.length === 1 ? "Consultant" : "Consultants"}
              </p>
              {consultants.map((doc) => (
                <Link key={doc.id} href={doctorHref(doc)} onClick={onNavigate}
                  className="group flex items-center gap-3 rounded-[10px] bg-[var(--paper)] p-2 transition-colors hover:bg-[var(--bone)]">
                  <span className="h-11 w-11 shrink-0 overflow-hidden rounded-[8px]">
                    <DoctorAvatar name={doc.name} image={doc.image} className="h-full w-full text-[11px]" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] font-semibold text-[var(--ink)]">{doc.name}</span>
                    <span className="block truncate text-[10.5px] text-[var(--teal)]">{doc.specialization}</span>
                  </span>
                  <ArrowRight size={13} className="shrink-0 text-[var(--muted)] transition-transform duration-300 group-hover:translate-x-0.5 group-hover:text-[var(--teal)]" />
                </Link>
              ))}
            </div>
          )}
        </aside>

        {/* ---- everything it covers ---- */}
        <div className={multi ? "grid grid-cols-2 gap-x-8 gap-y-6" : ""}>
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
      <div className="mb-3 flex items-center gap-3 border-b border-[var(--line)] pb-2">
        <p className="mono shrink-0 text-[9.5px] font-bold uppercase tracking-[0.18em] text-[var(--teal)]">
          {dept.name}
        </p>
        <span className="h-px flex-1 bg-[var(--line)]" />
        <Link href={`/book?dept=${encodeURIComponent(dept.name)}`} onClick={onNavigate}
          className="shrink-0 text-[11.5px] font-semibold text-[var(--teal)] hover:underline">
          Book →
        </Link>
      </div>
      {/* CSS columns keep an 11-item list three rows deep instead of eleven */}
      <ul className={newspaper ? "columns-3 gap-x-8" : ""}>
        {dept.services.map((s) => (
          <li key={s.name} className="break-inside-avoid">
            {/* the description rides along as a tooltip - it belongs on the
                department page, not crammed into a menu row */}
            <Link href={serviceHref(dept.name)} onClick={onNavigate} title={s.desc}
              className="block rounded-md py-[5px] text-[13.5px] leading-snug text-[var(--ink-soft)] transition-colors hover:text-[var(--teal)]">
              {s.name}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

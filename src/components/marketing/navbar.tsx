"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { User, ChevronDown, ArrowRight, ArrowUpRight, Search, PhoneCall } from "@/components/ui/hugeicons";
import { DeptIcon } from "@/components/marketing/dept-icon";
import { MenuIcon } from "@/components/marketing/menu-icon";
import { DoctorSearchBox } from "@/components/marketing/doctor-search-box";
import { DoctorAvatar } from "@/components/marketing/doctor-avatar";
import { HOSPITAL, DEPARTMENTS, CARE_AREAS, type CareArea, type Department, type Doctor } from "@/lib/data";
import { careHref } from "@/lib/care";
import { doctorHref } from "@/lib/doctors";
import { api } from "@/lib/api-client";

/**
 * The public header - one quiet row.
 *
 *   wordmark · Specialities ▾  Doctors  Health checks  Rooms & wards  Visit us · search  emergency  [Book]  login
 *
 * It used to be three tiers: a pine status strip, a row with a search field and
 * a bordered phone panel, and a second row of six care-area triggers. Ten
 * top-level choices at two weights, set against two background bands, read as
 * noise before anyone had found what they came for. Now there are five links,
 * all at one weight (500), and the six care areas live behind "Specialities" -
 * the mega panel still lists everything each area covers, it just isn't the
 * front door any more.
 *
 * NO BOLD ANYWHERE IN THE CHROME. Medium for links, semibold only for the
 * wordmark and the one panel heading. The header is furniture; it should not
 * shout over the page under it.
 *
 * Every sub-item links to the department page, which carries the full service
 * list and the consultant - and their live slots are one click on from there.
 *
 * The shell is plain white at rest - the hero is the same white, so
 * header and page read as one surface - and becomes frosted with a hairline
 * once the page has moved. Scrolling down tucks it away above the viewport;
 * scrolling up brings it back. Height never changes: `--nav-h` (site-theme.css)
 * is what every page offsets its first section from, and it is 72px at every
 * width now that there is no second row.
 */

const deptsOf = (a: CareArea) => DEPARTMENTS.filter((d) => a.departments.includes(d.name));
const doctorsOf = (doctors: Doctor[], dept: string) => doctors.filter((d) => d.department === dept);

const LINKS = [
  { label: "Doctors", href: "/doctors" },
  { label: "Health checks", href: "/health-checks" },
  { label: "Rooms & wards", href: "/#facilities" },
  { label: "Visit us", href: "/#visit" },
];

/**
 * OPD runs 08:00-20:00 on the days HOSPITAL.opdDays lists. The emergency
 * department never closes.
 *
 * The day check is the point: this used to test the clock only, so at 10am on a
 * Sunday - the one day there is no routine consulting - the header told
 * visitors "OPD open now". A status line that is wrong is worse than none.
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

/**
 * The panel is handed in, not imported.
 *
 * It comes from the ERP now, and this is a client component - it owns menu
 * state, scroll listeners and focus traps, none of which survive on the server.
 * So the layout reads the doctors and passes them down. See
 * server/services/public-doctors.service.ts.
 */
export function Navbar({ doctors }: { doctors: Doctor[] }) {
  const pathname = usePathname();
  const [mega, setMega] = useState(false);
  const [area, setArea] = useState(CARE_AREAS[0].label);
  const [search, setSearch] = useState(false);
  const [open, setOpen] = useState(false);
  const [mobileArea, setMobileArea] = useState<string | null>(null);
  const [stuck, setStuck] = useState(false);
  /** Tucked away above the viewport - see the scroll handler below. */
  const [tucked, setTucked] = useState(false);
  // Rendered only after mount: the server has no idea what time it is where
  // the visitor is, and a hydration mismatch on the first paint of a hospital
  // homepage is not worth a status line.
  const [opd, setOpd] = useState<ReturnType<typeof opdState> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLDivElement>(null);
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
   * Same unauthenticated endpoint the portal shells read, so a hospital that
   * uploads a logo gets it everywhere without touching code. Fetched after
   * mount rather than server-rendered: blocking every public page on a database
   * round-trip to draw a 32px mark is the wrong trade. Until it lands - and
   * forever, if none was uploaded - the built-in teal mark stands in.
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
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setMega(false); setSearch(false); setOpen(false); }
    };
    /**
     * Out of the way going down, back the moment you turn round.
     *
     * Reading down the page, the header slides up out of view and gives the
     * screen back to the content; any upward scroll - the gesture of somebody
     * looking for the menu - brings it straight back. It never hides in the
     * first two header-heights of the page, so the top of every page always
     * has its navigation, and a 6px dead band stops a trackpad's jitter from
     * flicking it in and out.
     */
    let last = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      setStuck(y > 12);
      if (y < 144) setTucked(false);
      else if (y - last > 6) setTucked(true);
      else if (last - y > 6) setTucked(false);
      else return; // inside the dead band - keep `last` where the move began
      last = y;
    };
    onScroll();
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  // Any navigation closes every overlay - including the browser's back button,
  // which none of the onClick handlers below would ever see.
  useEffect(() => { setMega(false); setSearch(false); setOpen(false); }, [pathname]);

  /** The search popover takes focus as it opens - it is a search box, and the
   *  click that opened it was already the intent to type. */
  useEffect(() => {
    if (search) searchRef.current?.querySelector("input")?.focus();
  }, [search]);

  /**
   * While the drawer is open the page behind it must not scroll. Locking `body`
   * rather than calling into Lenis on purpose: Lenis is mounted on the public
   * site only, and the navbar has to behave the same either way.
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
  const hold = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setSearch(false);
    setMega(true);
  };
  const release = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setMega(false), 140);
  };

  const close = () => { setMega(false); setSearch(false); setOpen(false); };

  /** `/#facilities` is a section of the homepage, never a page of its own - it only
   *  counts as "here" for the real routes. */
  const isActive = (href: string) => !href.includes("#") && pathname.startsWith(href);

  const raised = stuck || mega || search;
  // An open panel holds the header in place - it would otherwise slide away
  // with the menu you are reading still hanging from it.
  const hidden = tucked && !mega && !search && !open;

  return (
    <>
    <header
      data-stuck={stuck}
      data-hidden={hidden}
      /* focus-within: a keyboard visitor tabbing into a tucked header gets it
         back rather than focusing links they cannot see */
      className={`fixed inset-x-0 top-0 z-50 border-b transition-[transform,background-color,border-color] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] focus-within:translate-y-0 ${
        hidden ? "-translate-y-full" : "translate-y-0"
      } ${
        raised
          ? "border-[var(--line)] bg-white/85 backdrop-blur-xl backdrop-saturate-150"
          : "border-transparent bg-white"
      }`}
    >
      {/* Full width with the hero's 1.5rem edge, not the 1320px shell: the
          wordmark and the hero's first label hang off the same line. */}
      <div className="flex h-[var(--nav-h)] w-full items-center gap-4 px-[1.5rem]">
        {/* ── wordmark ─────────────────────────────────────────── */}
        <Link href="/" className="group flex shrink-0 items-center gap-2.5" aria-label="Jeeva - home" onClick={close}>
          {brand?.logoDataUrl ? (
            /* A plain <img>: the source is a base64 data URI out of the
               database, so there is nothing for the optimiser to fetch.
               `object-contain` because an uploaded logo is whatever shape it
               is - and no hover rotation, which is fine on our glyph and
               vandalism on somebody's actual logotype. */
            // eslint-disable-next-line @next/next/no-img-element
            <img src={brand.logoDataUrl} alt="" className="h-8 w-8 shrink-0 rounded-[9px] object-contain" />
          ) : (
            <span className="grid h-8 w-8 place-items-center rounded-[9px] bg-[var(--teal)] text-white transition-transform duration-500 group-hover:rotate-90" aria-hidden>
              <svg width="12" height="12" viewBox="0 0 14 14"><path d="M5 0h4v5h5v4H9v5H5V9H0V5h5z" fill="currentColor" /></svg>
            </span>
          )}
          {/* THE WORDMARK IS NOT THE BRAND NAME FROM SETTINGS, deliberately.
              That field holds "Jeeva Multi Speciality Hospital", which wraps on
              a phone and takes the header's height with it. The public site's
              copy comes from lib/data.ts; Settings drives the logo. */}
          <span className="leading-none">
            <span className="block [font-family:var(--font-display)] text-[17px] font-semibold tracking-[-0.025em] text-[var(--ink)]">
              {HOSPITAL.shortName}
            </span>
            <span className="mt-[3px] hidden text-[11px] font-medium tracking-[-0.005em] text-[var(--muted)] sm:block">
              Multispeciality Hospital
            </span>
          </span>
        </Link>

        {/* ── the five links (desktop) ─────────────────────────── */}
        <nav aria-label="Main" className="mx-auto hidden items-center gap-0.5 lg:flex" onMouseLeave={release}>
          <button
            type="button"
            onMouseEnter={hold}
            onClick={() => (mega ? setMega(false) : hold())}
            aria-expanded={mega}
            aria-controls="specialities-panel"
            className={`nav-link ${mega || pathname.startsWith("/care") ? "nav-link-on" : ""}`}
          >
            Specialities
            <ChevronDown size={13} className={`transition-transform duration-300 ${mega ? "rotate-180" : ""}`} />
          </button>
          {LINKS.map((l) => (
            <Link
              key={l.label}
              href={l.href}
              onMouseEnter={release}
              onClick={close}
              aria-current={isActive(l.href) ? "page" : undefined}
              className={`nav-link ${isActive(l.href) ? "nav-link-on" : ""}`}
            >
              {l.label}
            </Link>
          ))}
        </nav>

        {/* ── actions ──────────────────────────────────────────── */}
        <div className="ml-auto flex shrink-0 items-center gap-1.5 lg:ml-0">
          <button
            type="button"
            onClick={() => { setMega(false); setSearch((v) => !v); }}
            aria-label="Search doctors and specialities"
            aria-expanded={search}
            aria-controls="nav-search"
            className={`nav-icon hidden md:grid ${search ? "nav-icon-on" : ""}`}
          >
            <Search size={16} />
          </button>

          <a
            href={`tel:${emergency}`}
            className="hidden items-center gap-2 rounded-full px-3 py-[7px] text-[13px] font-medium text-[var(--ink-soft)] transition-colors hover:text-[var(--alert)] xl:inline-flex"
          >
            <span className="pulse pulse-alert" aria-hidden />
            Emergency 24×7
          </a>

          <Link href="/book" onClick={close} className="btn-ghost-sm hidden sm:inline-flex">
            Book appointment <ArrowUpRight size={14} />
          </Link>

          <Link href="/portal/login" aria-label="Patient login" onClick={close} className="nav-icon">
            <User size={16} />
          </Link>

          <button
            ref={toggleRef}
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            aria-controls="mobile-drawer"
            className="nav-icon lg:hidden"
          >
            <MenuIcon open={open} />
          </button>
        </div>
      </div>

      {/* ── Specialities - the mega panel ────────────────────────── */}
      {mega && (
        <div
          id="specialities-panel"
          className="mega-in absolute inset-x-0 top-full hidden lg:block"
          onMouseEnter={hold}
          onMouseLeave={release}
        >
          <div className="px-[1.5rem] pt-2">
            <SpecialitiesPanel
              doctors={doctors}
              area={area}
              onArea={setArea}
              opd={opd}
              onNavigate={close}
            />
          </div>
        </div>
      )}

      {/* ── search popover ───────────────────────────────────────── */}
      {search && (
        <div id="nav-search" className="mega-in absolute inset-x-0 top-full hidden md:block">
          <div className="shell-w pt-2">
            <div ref={searchRef} className="mx-auto max-w-[560px] rounded-[18px] bg-[var(--paper)] p-3 shadow-[var(--shadow-lift)]">
              <DoctorSearchBox doctors={doctors} variant="mobile" onNavigate={close} />
              <p className="px-2 pb-1 pt-2.5 text-[12px] text-[var(--muted)]">
                Try a name, a speciality, or what you need treated - “knee pain”, “child fever”.
              </p>
            </div>
          </div>
        </div>
      )}
    </header>

      {/* ── mobile drawer ──────────────────────────────────────────────────
          MOUNTED ALWAYS, MOVED WITH A TRANSFORM, so it can animate out as well
          as in; `inert` keeps its links out of the tab order while closed.

          AND IT IS A SIBLING OF THE HEADER, NOT A CHILD OF IT. Once scrolled
          the header carries `backdrop-filter`, which makes it the containing
          block for every `position: fixed` descendant - inside it the drawer
          would be fixed to the 72px header instead of to the viewport. ─────── */}
      <div className="lg:hidden">
        <div
          aria-hidden
          onClick={close}
          className={`fixed inset-0 z-[55] bg-[rgba(11,32,29,0.45)] backdrop-blur-[2px] transition-opacity duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${
            open ? "opacity-100" : "pointer-events-none opacity-0"
          }`}
        />

        <aside
          id="mobile-drawer"
          role="dialog"
          aria-modal={open || undefined}
          aria-label="Menu"
          inert={!open}
          className={`fixed inset-y-0 right-0 z-[60] flex w-[min(24rem,90vw)] flex-col bg-[var(--paper)] shadow-[var(--shadow-lift)] transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${
            open ? "translate-x-0" : "translate-x-full"
          }`}
        >
          <div className="flex h-[var(--nav-h)] flex-none items-center justify-between gap-3 px-5">
            <span className="min-w-0 leading-none">
              <span className="block [font-family:var(--font-display)] text-[17px] font-semibold tracking-[-0.025em] text-[var(--ink)]">
                {HOSPITAL.shortName}
              </span>
              <span className="mt-[3px] block truncate text-[11px] font-medium text-[var(--muted)]">
                {HOSPITAL.locality}
              </span>
            </span>
            <button ref={closeRef} onClick={close} aria-label="Close menu" className="nav-icon bg-[var(--bone)]">
              <MenuIcon open />
            </button>
          </div>

          {/* `data-lenis-prevent` hands wheel and touch inside this box back to
              the browser - otherwise Lenis scrolls the page behind the drawer
              and the drawer's own list will not move. */}
          <div data-lenis-prevent className="drawer-scroll min-h-0 flex-1 overflow-y-auto">
            <div className="px-5 pb-6">
              <DoctorSearchBox doctors={doctors} variant="mobile" onNavigate={close} />

              <p className="mt-7 text-[12px] font-medium text-[var(--muted)]">Specialities</p>
              <div className="mt-2 divide-y divide-[var(--line)] border-y border-[var(--line)]">
                {CARE_AREAS.map((a) => {
                  const on = mobileArea === a.label;
                  return (
                    <div key={a.label}>
                      <button
                        onClick={() => setMobileArea(on ? null : a.label)}
                        aria-expanded={on}
                        className="flex w-full items-center gap-3 py-3.5 text-left"
                      >
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-[var(--teal-soft)] text-[var(--teal)]">
                          <DeptIcon name={a.departments[0]} className="h-[18px] w-[18px]" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[15px] font-medium tracking-[-0.01em] text-[var(--ink)]">{a.label}</span>
                          <span className="block truncate text-[12px] text-[var(--muted)]">{a.blurb}</span>
                        </span>
                        <ChevronDown size={15} className={`shrink-0 text-[var(--muted)] transition-transform duration-300 ${on ? "rotate-180" : ""}`} />
                      </button>

                      {on && (
                        <div className="space-y-4 pb-4 pl-12">
                          {deptsOf(a).map((d) => (
                            <div key={d.name}>
                              <Link
                                href={careHref(d.name)}
                                onClick={close}
                                className="text-[13px] font-semibold text-[var(--teal)]"
                              >
                                {d.name} →
                              </Link>
                              <ul className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1">
                                {d.services.map((s) => (
                                  <li key={s.name}>
                                    <Link
                                      href={careHref(d.name)}
                                      onClick={close}
                                      className="block py-0.5 text-[12.5px] leading-snug text-[var(--ink-soft)] hover:text-[var(--teal)]"
                                    >
                                      {s.name}
                                    </Link>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <nav aria-label="Main" className="mt-2">
                {LINKS.map((l) => (
                  <Link
                    key={l.label}
                    href={l.href}
                    onClick={close}
                    className="flex items-center justify-between border-b border-[var(--line)] py-3.5 text-[15px] font-medium tracking-[-0.01em] text-[var(--ink)] transition-colors hover:text-[var(--teal)]"
                  >
                    {l.label}
                    <ArrowRight size={14} className="text-[var(--muted)]" />
                  </Link>
                ))}
              </nav>

              <div className="mt-6 space-y-2">
                <Link href="/book" onClick={close} className="flex items-center justify-center gap-1.5 rounded-full bg-[var(--ink)] py-3 text-[14px] font-medium text-white">
                  Book an appointment <ArrowUpRight size={15} />
                </Link>
                <div className="grid grid-cols-2 gap-2">
                  <a href={`tel:${phone}`} className="flex items-center justify-center gap-1.5 rounded-full border border-[var(--line-strong)] py-3 text-[13px] font-medium text-[var(--ink)]">
                    <PhoneCall size={14} /> Call desk
                  </a>
                  <a href={`tel:${emergency}`} className="flex items-center justify-center gap-2 rounded-full border border-[var(--alert)]/30 py-3 text-[13px] font-medium text-[var(--alert)]">
                    <span className="pulse pulse-alert" aria-hidden /> Emergency
                  </a>
                </div>
                <Link href="/portal/login" onClick={close} className="flex items-center justify-center gap-1.5 rounded-full py-3 text-[13px] font-medium text-[var(--ink-soft)] hover:text-[var(--teal)]">
                  <User size={14} /> Patient login
                </Link>
              </div>

              <p className="mt-4 flex items-center justify-center gap-2 text-[12px] text-[var(--muted)]">
                <span className={`pulse ${opd && !opd.open ? "pulse-alert" : ""}`} aria-hidden />
                {opd ? opd.text : `OPD ${HOSPITAL.opdHours}`}
              </p>
            </div>
          </div>
        </aside>
      </div>
    </>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   The Specialities panel. Left: the six care areas, hover or focus to pick
   one. Right: everything that area covers, then who runs it. One floating
   card rather than a full-bleed sheet, so it reads as a menu over the page
   instead of a second page sliding over the first.
   ───────────────────────────────────────────────────────────────────────── */
function SpecialitiesPanel({
  doctors,
  area,
  onArea,
  opd,
  onNavigate,
}: {
  doctors: Doctor[];
  area: string;
  onArea: (label: string) => void;
  opd: ReturnType<typeof opdState> | null;
  onNavigate: () => void;
}) {
  const current = CARE_AREAS.find((a) => a.label === area) ?? CARE_AREAS[0];
  const depts = deptsOf(current);
  const multi = depts.length > 1;
  const consultants = depts.flatMap((d) => doctorsOf(doctors, d.name)).slice(0, 4);

  return (
    <div className="overflow-hidden rounded-[20px] bg-[var(--paper)] shadow-[var(--shadow-lift)]">
      <div className="grid grid-cols-[260px_1fr]">
        {/* ---- the areas ---- */}
        <ul className="space-y-0.5 bg-[var(--bone)]/60 p-3">
          {CARE_AREAS.map((a) => {
            const on = a.label === current.label;
            return (
              <li key={a.label}>
                <button
                  type="button"
                  onMouseEnter={() => onArea(a.label)}
                  onFocus={() => onArea(a.label)}
                  onClick={() => onArea(a.label)}
                  aria-pressed={on}
                  className={`flex w-full items-center gap-3 rounded-[12px] px-3 py-2.5 text-left transition-colors ${
                    on ? "bg-[var(--paper)] text-[var(--ink)]" : "text-[var(--ink-soft)] hover:text-[var(--ink)]"
                  }`}
                >
                  <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-[9px] transition-colors ${on ? "bg-[var(--teal)] text-white" : "bg-[var(--teal-soft)] text-[var(--teal)]"}`}>
                    <DeptIcon name={a.departments[0]} className="h-[17px] w-[17px]" />
                  </span>
                  <span className="text-[14px] font-medium tracking-[-0.01em]">{a.label}</span>
                </button>
              </li>
            );
          })}
        </ul>

        {/* ---- what it covers ---- */}
        <div className="flex min-h-[340px] flex-col p-7">
          <div className="flex items-start justify-between gap-6">
            <div>
              <p className="[font-family:var(--font-display)] text-[22px] font-medium tracking-[-0.03em] text-[var(--ink)]">{current.label}</p>
              <p className="mt-1 max-w-[52ch] text-[13px] leading-relaxed text-[var(--muted)]">{current.blurb}</p>
            </div>
            <Link href="/doctors" onClick={onNavigate} className="btn-ghost-sm shrink-0">
              All doctors <ArrowRight size={13} />
            </Link>
          </div>

          <div className={`mt-6 flex-1 ${multi ? "grid grid-cols-2 gap-x-10 gap-y-6 xl:grid-cols-3" : ""}`}>
            {depts.map((d) => (
              <DeptColumn key={d.name} dept={d} newspaper={!multi} onNavigate={onNavigate} />
            ))}
          </div>

          <div className="mt-6 flex items-center justify-between gap-6 border-t border-[var(--line)] pt-4">
            <div className="flex min-w-0 flex-wrap gap-2">
              {consultants.map((doc) => (
                <Link
                  key={doc.id}
                  href={doctorHref(doc)}
                  onClick={onNavigate}
                  className="flex items-center gap-2 rounded-full bg-[var(--bone)] py-1 pl-1 pr-3 transition-colors hover:bg-[var(--teal-soft)]"
                >
                  <span className="h-7 w-7 shrink-0 overflow-hidden rounded-full">
                    <DoctorAvatar name={doc.name} className="h-full w-full text-[9px]" />
                  </span>
                  <span className="truncate text-[12.5px] font-medium text-[var(--ink)]">{doc.name}</span>
                </Link>
              ))}
            </div>
            <span className="flex shrink-0 items-center gap-2 text-[12px] text-[var(--muted)]">
              <span className={`pulse ${opd && !opd.open ? "pulse-alert" : ""}`} aria-hidden />
              {opd ? opd.text : `OPD ${HOSPITAL.opdHours}`}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function DeptColumn({ dept, newspaper, onNavigate }: { dept: Department; newspaper: boolean; onNavigate: () => void }) {
  return (
    <div>
      <Link
        href={careHref(dept.name)}
        onClick={onNavigate}
        className="group mb-2 inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-[var(--teal)]"
      >
        {dept.name}
        <ArrowRight size={12} className="transition-transform duration-300 group-hover:translate-x-0.5" />
      </Link>
      {/* CSS columns keep an 11-item list three rows deep instead of eleven */}
      <ul className={newspaper ? "columns-3 gap-x-10" : ""}>
        {dept.services.map((s) => (
          <li key={s.name} className="break-inside-avoid">
            {/* the description rides along as a tooltip - it belongs on the
                department page, not crammed into a menu row */}
            <Link
              href={careHref(dept.name)}
              onClick={onNavigate}
              title={s.desc}
              className="block py-[5px] text-[13.5px] leading-snug text-[var(--ink-soft)] transition-colors hover:text-[var(--teal)]"
            >
              {s.name}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

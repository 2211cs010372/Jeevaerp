import Link from "next/link";
import { HOSPITAL, DEPARTMENTS } from "@/lib/data";

/**
 * The footer, as the end of the last dark room.
 *
 * It shares the pine field with the closing CTA above it, so the page finishes
 * on one continuous surface. The wordmark is set enormous and at 7% white -
 * a watermark, not a headline - which is the one place on the site where type
 * is allowed to be pure texture.
 *
 * Every icon here does something real: call, mail, directions. No dead social
 * links, because a row of greyed-out logos is a promise the hospital hasn't
 * made.
 */
export function Footer() {
  return (
    <footer className="relative isolate overflow-hidden bg-[var(--pine-ink)] text-white">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(100%_70%_at_50%_100%,rgba(23,112,95,0.22),transparent_65%)]"
      />

      <div className="shell-w pt-16 sm:pt-20">
        <div className="grid gap-x-10 gap-y-12 border-t border-white/12 pt-12 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1.3fr]">
          <div>
            <div className="flex items-center gap-2.5">
              <span
                className="grid h-9 w-9 place-items-center rounded-[11px] bg-[var(--teal)] text-white"
                aria-hidden
              >
                <svg width="13" height="13" viewBox="0 0 14 14">
                  <path d="M5 0h4v5h5v4H9v5H5V9H0V5h5z" fill="currentColor" />
                </svg>
              </span>
              <span className="display text-[20px] tracking-[-0.04em]">{HOSPITAL.shortName}</span>
            </div>
            <p className="mt-5 max-w-xs text-[13.5px] leading-[1.7] text-white/55">
              {HOSPITAL.tagline} — {DEPARTMENTS.length} departments, one building,
              one record for every patient.
            </p>
          </div>

          <nav aria-label="Site">
            <p className="mono text-[10px] uppercase tracking-[0.2em] text-white/35">Discover</p>
            <ul className="mt-5 space-y-3 text-[13.5px]">
              {[
                { href: "/about", label: "About the hospital" },
                { href: "/doctors", label: "Doctors" },
                { href: "/#specialities", label: "Specialities" },
                { href: "/health-checks", label: "Health checks" },
                { href: "/#facilities", label: "Rooms & wards" },
                { href: "/book", label: "Book an appointment" },
                { href: "/portal/login", label: "Patient portal" },
              ].map((l) => (
                <li key={l.href}>
                  <Link
                    href={l.href}
                    className="text-white/70 transition-colors hover:text-white"
                  >
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <div>
            <p className="mono text-[10px] uppercase tracking-[0.2em] text-white/35">Hours</p>
            <p className="mono mt-5 text-[13.5px] text-white/90">OPD · {HOSPITAL.opdHours}</p>
            <p className="mt-1 text-[13px] text-white/50">Seven days, including Sunday.</p>
            <p className="mono mt-4 text-[13.5px] font-semibold text-[#ff9c8a]">
              Emergency · 24×7
            </p>
            <p className="mt-1 text-[13px] text-white/50">Every day, including holidays.</p>
          </div>

          <div>
            <p className="mono text-[10px] uppercase tracking-[0.2em] text-white/35">Reach us</p>
            <ul className="mt-5 space-y-3">
              <li>
                <a
                  href={`tel:${HOSPITAL.phone.replace(/\s/g, "")}`}
                  className="group flex items-center gap-3 text-[13.5px] text-white/80 transition-colors hover:text-white"
                >
                  <Dot>
                    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
                  </Dot>
                  <span className="mono">{HOSPITAL.phone}</span>
                </a>
              </li>
              <li>
                <a
                  href={`mailto:${HOSPITAL.email}`}
                  className="group flex items-center gap-3 text-[13px] text-white/70 transition-colors hover:text-white"
                >
                  <Dot>
                    <rect x="2" y="4" width="20" height="16" rx="3" />
                    <path d="m2 7 10 7L22 7" />
                  </Dot>
                  <span className="break-all">{HOSPITAL.email}</span>
                </a>
              </li>
              <li>
                <a
                  href={HOSPITAL.mapUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="group flex items-start gap-3 text-[13px] leading-[1.65] text-white/70 transition-colors hover:text-white"
                >
                  <Dot className="mt-0.5">
                    <path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0Z" />
                    <circle cx="12" cy="10" r="3" />
                  </Dot>
                  {HOSPITAL.address}
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-16 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 py-7">
          <p className="text-[12.5px] text-white/45">
            © {new Date().getFullYear()} {HOSPITAL.name}. All rights reserved.
          </p>
          <p className="mono text-[10px] uppercase tracking-[0.16em] text-white/35">
            {HOSPITAL.locality}
          </p>
        </div>
      </div>

      {/* the watermark - texture, not a heading, so it stays out of the a11y tree */}
      <p aria-hidden className="wordmark -mb-[0.14em] select-none text-center">
        {HOSPITAL.shortName}
      </p>
    </footer>
  );
}

function Dot({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      aria-hidden
      className={`grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/10 transition-colors group-hover:bg-[var(--teal)] ${className}`}
    >
      <svg
        width="13"
        height="13"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {children}
      </svg>
    </span>
  );
}

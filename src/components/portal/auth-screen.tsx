"use client";

import { useEffect, useState } from "react";
import { classifyHost } from "@/lib/auth/host";
import { StaffLogin } from "@/components/portal/staff-login";

/**
 * The staff sign-in screen.
 *
 * Full-bleed, two halves, no floating card. The left half is "the board" - the
 * roster bolted above a nurses' station, listing every desk in the building
 * with the one you are signing in to lit. The right half is porcelain and holds
 * nothing but the form.
 *
 * The board is not decoration. Staff bookmark the wrong portal constantly (a
 * lab tech lands on /reception/login and has no way out but the URL bar), so
 * every row is a real link to that desk's sign-in. The list doubles as the
 * product's one-line pitch: five desks, one patient record.
 *
 * Skin lives in portal-theme.css under "AUTH SCREEN"; the tokens there are the
 * portals' own pine with the lights off, so this reads as the same product.
 */

/** Every desk in the building, in the order a patient passes through them -
 *  admin last, because it is the only one that is not on that path. The codes
 *  are what staff already say out loud ("send it to LAB"), not invented IDs. */
const DESKS = [
  { key: "reception", code: "OPD", name: "Front desk", does: "Registration, appointments, billing" },
  { key: "doctor", code: "CON", name: "Consulting room", does: "Consultations and prescriptions" },
  { key: "pharmacy", code: "PHR", name: "Pharmacy", does: "Dispensing and stock" },
  { key: "labs", code: "LAB", name: "Laboratory", does: "Samples, results, reports" },
  { key: "admin", code: "ADM", name: "Administration", does: "Staff, beds, settings" },
] as const;

/**
 * Where a desk's sign-in actually lives, for the host we are being served from.
 *
 * The portals route two ways (see lib/auth/host.ts): as subdomains on a real
 * domain and on localhost, and as path prefixes on *.vercel.app. A hardcoded
 * "/labs/login" is only correct in the second shape - in the first, the
 * middleware would read it as a path UNDER the current portal and rewrite it
 * to /reception/labs/login, i.e. a 404. So the board asks the same classifier
 * the middleware uses, and builds an absolute cross-subdomain URL when that is
 * the shape in play.
 *
 * Host is a browser-only fact, so until mount every row falls back to the path
 * form. That is a valid link in path mode and is corrected on hydration, long
 * before anyone can aim at a 15px row.
 */
function useDeskHref() {
  const [loc, setLoc] = useState<{ host: string; protocol: string } | null>(null);
  useEffect(() => setLoc({ host: window.location.host, protocol: window.location.protocol }), []);

  return (portal: string) => {
    if (!loc) return `/${portal}/login`;
    const { subdomainMode, rootDomain, port } = classifyHost(loc.host);
    if (!subdomainMode || !rootDomain) return `/${portal}/login`;
    return `${loc.protocol}//${portal}.${rootDomain}${port ? `:${port}` : ""}/login`;
  };
}

/** One sinus beat, drawn relative so it tiles seamlessly. 300 units wide,
 *  returning to the baseline exactly - flat, P bump, QRS spike, flat, T wave. */
const BEAT = "h58 c6 -7 18 -7 24 0 h16 l10 6 l8 -34 l8 62 l8 -34 h18 c10 -12 26 -12 36 0 h114";
const TRACE = `M0 40 ${BEAT.repeat(4)}`;

/** The mark: the same trace at 20px. The glyph at the top of the board and the
 *  line at the bottom of it are the same object, which is the whole idea. */
function Mark({ className = "" }: { className?: string }) {
  return (
    <span
      className={`flex h-9 w-9 flex-none items-center justify-center rounded-[10px] border border-[var(--a-hair)] bg-[var(--a-board-lift)] ${className}`}
    >
      <svg width="19" height="12" viewBox="0 0 26 16" fill="none" aria-hidden>
        <path
          d="M1 8h6l2 4 3-11 3 14 2-7h8"
          stroke="var(--a-lit)"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

/** Date and time, client-only. The board has a clock because a real one does;
 *  it is also the honest version of the "SYSTEM_GATEWAY_ONLINE" line it
 *  replaces - something that is actually true and actually changes. */
function Clock() {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000 * 30);
    return () => clearInterval(id);
  }, []);

  return (
    <div
      className="font-mono text-[11px] tracking-[0.1em] text-[var(--a-chalk-dim)] transition-opacity duration-500"
      style={{ opacity: now ? 1 : 0 }}
    >
      {now ? (
        <>
          <span className="text-[var(--a-chalk)]">
            {now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false })}
          </span>
          <span className="mx-2 opacity-40">/</span>
          {now.toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short" })}
        </>
      ) : (
        <span aria-hidden>&nbsp;</span>
      )}
    </div>
  );
}

export function AuthScreen({ portalName, portalKey = "reception" }: { portalName: string; portalKey?: string }) {
  const deskHref = useDeskHref();

  return (
    <div className="portal authx min-h-[100dvh] lg:grid lg:grid-cols-[1.05fr_1fr]" data-portal={portalKey}>
      {/* ==================== THE BOARD ==================== */}
      <aside className="authx-board relative flex flex-col justify-between overflow-hidden px-6 py-8 sm:px-10 lg:px-14 lg:py-12 xl:px-20">
        {/* brand */}
        <div className="flex items-center gap-3" data-lift style={{ "--i": 0 } as React.CSSProperties}>
          <Mark />
          <div className="leading-none">
            <div className="text-[19px] font-semibold tracking-[-0.02em] text-white" style={{ fontFamily: "var(--font-bricolage)" }}>
              Jeeva
            </div>
            <div className="authx-code mt-1.5">HOSPITAL SYSTEM</div>
          </div>
        </div>

        {/* thesis + the board itself */}
        <div className="hidden lg:block">
          <h1
            className="max-w-[15ch] text-[clamp(2.6rem,4.1vw,3.9rem)] font-semibold leading-[0.98] tracking-[-0.035em] text-white"
            style={{ fontFamily: "var(--font-bricolage)" }}
            data-lift
          >
            One record.
            <br />
            Every desk.
          </h1>
          <p
            className="mt-5 max-w-[46ch] text-[14.5px] leading-[1.65] text-[var(--a-chalk-dim)]"
            data-lift
            style={{ "--i": 1 } as React.CSSProperties}
          >
            Reception, consulting rooms, pharmacy, labs and administration all write to the same
            patient file. What one desk enters, the next desk already has.
          </p>

          <nav className="mt-11" aria-label="Sign in at another desk">
            <div className="authx-code mb-1 block">DESKS</div>
            {DESKS.map((d, i) => (
              <a
                key={d.key}
                href={deskHref(d.key)}
                className="authx-desk"
                data-here={d.key === portalKey}
                aria-current={d.key === portalKey ? "page" : undefined}
                data-lift
                style={{ "--i": i + 2 } as React.CSSProperties}
              >
                <span className="authx-code">{d.code}</span>
                <span className="text-[15px] font-medium tracking-[-0.01em]">{d.name}</span>
                <span className="hidden text-[12.5px] text-[var(--a-chalk-dim)] sm:block">{d.does}</span>
              </a>
            ))}
          </nav>
        </div>

        {/* trace + clock */}
        <div className="mt-8 lg:mt-0" data-lift style={{ "--i": 7 } as React.CSSProperties}>
          <svg
            viewBox="0 0 1200 80"
            className="h-9 w-full text-[var(--a-lit)] opacity-60"
            fill="none"
            preserveAspectRatio="none"
            aria-hidden
          >
            <path d={TRACE} stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" className="authx-trace" vectorEffect="non-scaling-stroke" />
          </svg>
          <div className="mt-4 flex items-center justify-between border-t border-[var(--a-hair)] pt-4">
            <Clock />
            <span className="authx-code">HANAMKONDA</span>
          </div>
        </div>

        {/* Below lg the board collapses to this strip: the desks stay reachable
            as codes, because landing on the wrong portal on a phone is worse. */}
        <nav className="mt-7 flex flex-wrap gap-2 lg:hidden" aria-label="Sign in at another desk">
          {DESKS.map((d) => (
            <a
              key={d.key}
              href={deskHref(d.key)}
              aria-current={d.key === portalKey ? "page" : undefined}
              className={`rounded-full border px-3 py-1.5 font-mono text-[11px] tracking-[0.12em] transition-colors ${
                d.key === portalKey
                  ? "border-[var(--a-hair-lit)] bg-[var(--a-board-lift)] text-[var(--a-lit)]"
                  : "border-[var(--a-hair)] text-[var(--a-chalk-dim)]"
              }`}
            >
              {d.code}
            </a>
          ))}
        </nav>
      </aside>

      {/* ==================== THE FORM ==================== */}
      <main className="authx-form-side flex min-h-[62dvh] flex-col justify-center px-6 py-12 sm:px-10 lg:min-h-[100dvh] lg:px-14 xl:px-20">
        <div className="mx-auto w-full max-w-[380px]">
          <StaffLogin portalName={portalName} />

          <p className="mt-10 border-t border-[var(--p-border)] pt-5 text-[12.5px] leading-relaxed text-[var(--p-muted)]">
            Accounts are created by the hospital administrator. If your username is not recognised,
            ask the front office to check your desk access.
          </p>
        </div>
      </main>
    </div>
  );
}

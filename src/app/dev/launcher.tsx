"use client";

import { useCallback, useEffect, useState } from "react";
import { Icon, type IconName } from "@/components/portal/ui/icons";
import { PortalScroll } from "@/components/portal/portal-scroll";
import { PORTALS } from "@/lib/portal/nav";
import { PORTAL_LABEL, SUBDOMAIN_ALLOWED_ROLES, type PortalSubdomain } from "@/lib/auth/portals";
import { api } from "@/lib/api-client";

/**
 * THE DEVELOPER'S LAUNCHER.
 *
 * One screen whose entire content is doors into the other six portals, for the
 * person who maintains the system rather than works a desk in it. Everything on
 * it is derived - the portal list from PORTAL_SUBDOMAINS, who may enter from
 * SUBDOMAIN_ALLOWED_ROLES, the deep links from each portal's own sidebar
 * config - so a portal or a screen added anywhere else shows up here without
 * this file being touched, and cannot show up here claiming access it does not
 * have.
 *
 * It is a launcher, not a dashboard: no counts, no money, no clinical data. A
 * developer opening this at 2am wants to get INTO a portal, and a page that
 * fetches six portals' worth of statistics to decide what to show is a page
 * that is down whenever any of them is.
 */

export interface PortalLink {
  key: Exclude<PortalSubdomain, "dev">;
  /** Absolute in subdomain mode, a path prefix in path mode. Resolved server-side. */
  base: string;
}

interface Me {
  id: string;
  name: string;
  role: string;
  email: string | null;
}

/** Journey order, not alphabetical: a patient's path through the building. */
const ORDER: Exclude<PortalSubdomain, "dev">[] = [
  "reception", "doctor", "labs", "pharmacy", "insurance", "admin",
];

const FACE: Record<Exclude<PortalSubdomain, "dev">, { icon: IconName; blurb: string; note?: string }> = {
  reception: { icon: "users", blurb: "Register, book, bill and admit. The front desk's whole day." },
  doctor: {
    icon: "stethoscope",
    blurb: "Today's clinic list, lab results and patient charts.",
    // Earned honesty: an admin has no Doctor profile of their own, so this
    // portal asks whose day to show rather than pretending it is theirs.
    note: "Admins pick a doctor and read; only that doctor can close a consultation.",
  },
  labs: { icon: "flask", blurb: "Test queue, results, the catalogue and the bench's billing." },
  pharmacy: { icon: "pill", blurb: "Dispensing, stock, purchase orders and dues to collect." },
  insurance: { icon: "shield", blurb: "Pre-auths, claims, and what the insurers still owe." },
  admin: { icon: "building", blurb: "Accounts, HR, audit log, wards and hospital settings." },
};

/** How many deep links fit on a card before it stops being scannable. */
const CHIP_LIMIT = 6;

/**
 * Every door on this page opens in its own tab.
 *
 * The launcher is a place you come back to. Following a link in-place means
 * that after reading a bill in reception you are one Back press from here and
 * six from where you started, and in subdomain mode Back also re-runs a portal's
 * auth redirect - so the way home is not reliably behind you at all. Six portals
 * open side by side is what somebody debugging across desks actually wants.
 *
 * `noopener` and not `noreferrer`: these are our own portals, and in path mode
 * the login gate reads the referer to work out which portal a sign-in was
 * attempted at (see portalFromRequest). Keep the header.
 */
const NEW_TAB = { target: "_blank", rel: "noopener" } as const;

export function Launcher({
  portals, host, routing, sessionSpansPortals, loginHref,
}: {
  portals: PortalLink[];
  host: string;
  routing: "subdomain" | "path";
  sessionSpansPortals: boolean;
  loginHref: string;
}) {
  const [me, setMe] = useState<Me | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => { api.get<Me>("/auth/me").then(setMe).catch(() => {}); }, []);

  const signOut = useCallback(async () => {
    setSigningOut(true);
    try { await api.post("/auth/logout"); } catch { /* the cookie is cleared either way */ }
    window.location.assign(loginHref);
  }, [loginHref]);

  const byKey = new Map(portals.map((p) => [p.key, p]));
  const ordered = ORDER.map((k) => byKey.get(k)).filter((p): p is PortalLink => Boolean(p));

  return (
    <PortalScroll>
      <div className="mx-auto max-w-6xl px-5 py-8 sm:px-8 sm:py-12">

        {/* ── Who you are, and the way out ──────────────────────────────── */}
        <header data-rise className="surface dotgrid mb-4 flex flex-wrap items-start justify-between gap-4 px-6 py-6">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-[var(--p-blue)] text-white shadow-[0_4px_12px_-4px_var(--p-blue-glow)]">
                <Icon name="grid" size={18} />
              </span>
              <h1 className="font-serif-p text-[24px] font-semibold leading-none text-[var(--p-ink)]">
                Developer console
              </h1>
            </div>
            <p className="mt-2.5 max-w-xl text-[14px] leading-relaxed text-[var(--p-muted)]">
              Every portal in the hospital, one click away — and the screens inside them,
              so you land on the one you meant rather than on somebody&apos;s dashboard.
              Each opens in its own tab, so this page stays where you left it.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <div className="text-right">
              <div className="text-[13px] font-semibold text-[var(--p-ink)]">
                {me?.name ?? "…"}
              </div>
              <div className="font-mono text-[11px] uppercase tracking-wide text-[var(--p-muted)]">
                {me?.role ?? ""}
              </div>
            </div>
            <button
              type="button"
              onClick={signOut}
              disabled={signingOut}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--p-border)] px-3 py-2 text-[13px] font-semibold text-[var(--p-text)] transition-colors hover:border-[var(--p-rose)] hover:text-[var(--p-rose)] disabled:opacity-50"
            >
              <Icon name="logout" size={15} />
              {signingOut ? "Signing out…" : "Sign out"}
            </button>
          </div>
        </header>

        {/* ── How this deployment is wired ──────────────────────────────────
            Not decoration. Which of the two routing shapes is live decides
            whether the links below are absolute or path-prefixed, and whether
            the session survives the hop - and getting that wrong is most of the
            time anybody loses on a portal that "won't let me in". */}
        <section data-rise className="surface mb-6 flex flex-wrap items-center gap-x-8 gap-y-3 px-6 py-4">
          <Fact label="Serving" value={host} mono />
          <Fact label="Routing" value={routing === "subdomain" ? "portal subdomains" : "path prefixes"} />
          <Fact
            label="This session"
            value={sessionSpansPortals ? "spans every portal" : "this portal only"}
            tone={sessionSpansPortals ? "ok" : "warn"}
          />
          {!sessionSpansPortals && (
            <p className="w-full text-[12.5px] leading-relaxed text-[var(--p-amber)]">
              The cookie is host-only, so each portal below will ask you to sign in again.
              Set <code className="font-mono">COOKIE_DOMAIN=.localhost</code> in <code className="font-mono">.env</code> and
              restart to carry one sign-in across all of them.
            </p>
          )}
        </section>

        {/* ── The doors ─────────────────────────────────────────────────── */}
        <div className="grid gap-4 md:grid-cols-2">
          {ordered.map((p) => (
            <PortalCard key={p.key} portal={p} viewerRole={me?.role} />
          ))}
        </div>
      </div>
    </PortalScroll>
  );
}

function Fact({ label, value, mono, tone }: {
  label: string; value: string; mono?: boolean; tone?: "ok" | "warn";
}) {
  const ink = tone === "warn" ? "text-[var(--p-amber)]" : tone === "ok" ? "text-[var(--p-cyan-deep)]" : "text-[var(--p-ink)]";
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--p-muted)]">{label}</div>
      <div className={`mt-0.5 text-[13.5px] font-semibold ${mono ? "font-mono" : ""} ${ink}`}>{value}</div>
    </div>
  );
}

function PortalCard({ portal, viewerRole }: { portal: PortalLink; viewerRole?: string }) {
  const { key, base } = portal;
  const face = FACE[key];
  const meta = PORTALS[key];
  const allowed = SUBDOMAIN_ALLOWED_ROLES[key];

  // Truthful rather than assumed. Only ADMIN reaches this page today, and ADMIN
  // is on every list - but reading the same table the middleware reads means
  // this card can never advertise a door the server would shut.
  const canEnter = viewerRole === undefined || allowed.some((r) => r === viewerRole);

  const nav = meta?.nav ?? [];
  const chips = nav.filter((n) => n.href !== "/").slice(0, CHIP_LIMIT);
  const overflow = Math.max(0, nav.filter((n) => n.href !== "/").length - chips.length);

  const href = (path: string) => `${base}${path === "/" ? "" : path}`;

  return (
    <article data-rise className="surface surface-hover flex flex-col px-6 py-5">
      <a
        href={canEnter ? href("/") : undefined}
        {...NEW_TAB}
        aria-disabled={!canEnter}
        className={`group flex items-start gap-4 ${canEnter ? "" : "pointer-events-none opacity-55"}`}
      >
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[var(--p-blue-soft)] text-[var(--p-blue)]">
          <Icon name={face.icon} size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-[16px] font-semibold text-[var(--p-ink)]">{PORTAL_LABEL[key]}</h2>
            {/* An arrow leaving the corner, not a chevron sliding right: these
                links open a tab rather than move this one. */}
            <Icon name="external" size={13} className="text-[var(--p-muted)] transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-[var(--p-blue)]" />
          </div>
          <p className="mt-1 text-[13.5px] leading-relaxed text-[var(--p-muted)]">{face.blurb}</p>
        </div>
      </a>

      <div className="mt-3.5 flex flex-wrap items-center gap-1.5">
        {allowed.map((r) => (
          <span key={r} className="rounded-full bg-[var(--p-slate-soft)] px-2 py-0.5 font-mono text-[10.5px] font-semibold uppercase tracking-wide text-[var(--p-slate)]">
            {r}
          </span>
        ))}
      </div>

      {face.note && (
        <p className="mt-2.5 text-[12.5px] leading-relaxed text-[var(--p-amber)]">{face.note}</p>
      )}

      {chips.length > 0 && (
        <div className="mt-4 border-t border-[var(--p-border)] pt-3.5">
          <div className="flex flex-wrap gap-1.5">
            {chips.map((n) => (
              <a
                key={n.href}
                href={href(n.href)}
                {...NEW_TAB}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--p-border)] px-2.5 py-1.5 text-[12.5px] font-medium text-[var(--p-text)] transition-colors hover:border-[var(--p-blue)] hover:bg-[var(--p-blue-soft)] hover:text-[var(--p-blue)]"
              >
                <Icon name={n.icon} size={13} />
                {n.label}
              </a>
            ))}
            {overflow > 0 && (
              <a
                href={href("/")}
                {...NEW_TAB}
                className="inline-flex items-center rounded-lg px-2.5 py-1.5 text-[12.5px] font-semibold text-[var(--p-blue)] hover:underline"
              >
                +{overflow} more
              </a>
            )}
          </div>
        </div>
      )}
    </article>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/portal/ui/icons";
import { CommandBar } from "@/components/portal/shell/command-bar";
import { SettingsPanel, type Me } from "@/components/portal/shell/settings-panel";
import { themeBootScript } from "@/lib/portal/theme";
import type { NavItem } from "@/lib/portal/nav";
import { PORTALS } from "@/lib/portal/nav";
import { api } from "@/lib/api-client";
import { useLive } from "@/lib/realtime/use-live";
import { isTopic } from "@/lib/realtime/topics";

/**
 * The hospital's logo, or the built-in stethoscope mark when none is set.
 *
 * Plain <img> rather than next/image on purpose: the source is a base64 data URI
 * out of the database, so there is nothing for the image optimiser to fetch,
 * resize or cache - it would only add a proxy hop to bytes we already hold.
 */
function BrandMark({ logo, name }: { logo: string | null; name: string }) {
  if (logo) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={logo} alt={name}
        className="h-8 w-8 shrink-0 rounded-lg object-contain" />
    );
  }
  return (
    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--p-blue)] text-white shadow-[0_4px_12px_-4px_var(--p-blue-glow)]">
      <Icon name="stethoscope" size={17} />
    </span>
  );
}

export function PortalShell({
  portalKey, userName, title, children, hiddenNavHrefs,
}: {
  portalKey: string; userName: string; title: string; children: React.ReactNode;
  /**
   * Nav hrefs to leave out of the sidebar, decided by the portal's own layout
   * from hospital settings.
   *
   * Passed in rather than fetched here on purpose: the layout is a server
   * component that can read config directly, so the sidebar renders correct on
   * the first paint. Fetching it in the shell would make every admin see the
   * tab flash in and then vanish.
   *
   * This hides a link. It is NOT a permission - the route and its API stay
   * exactly as reachable and as ADMIN-gated as before.
   */
  hiddenNavHrefs?: string[];
}) {
  const meta = PORTALS[portalKey];
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const hidden = useMemo(() => new Set(hiddenNavHrefs ?? []), [hiddenNavHrefs]);

  // pathname arrives rewritten as /reception/... - strip the portal prefix to match nav hrefs.
  const localPath = pathname.replace(new RegExp(`^/${portalKey}`), "") || "/";

  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => {
    if (localPath === "/login") return;
    api.get<Me>("/auth/me").then(setMe).catch(() => {});
  }, [localPath]);

  const [settingsOpen, setSettingsOpen] = useState(false);

  // ── The nav drawer (phones) ──────────────────────────────────────────────
  //
  // The nav used to expand INLINE, pushing the page down and then letting it
  // spring back on close - so tapping "Billing" moved the thing you were
  // reading. It is now a drawer that slides in from the left edge, over the
  // page, and the page behind it is LOCKED while it is open: it cannot scroll,
  // cannot be tapped through the scrim, and cannot be tabbed into.
  //
  // The lock is the part that matters on a phone. The nav list is longer than
  // the screen, so it scrolls - and without a lock a drag that starts on the
  // menu and continues past its end scrolls the ward list underneath instead,
  // which is how somebody loses their place in a queue they were working down.
  const drawerRef = useRef<HTMLDivElement | null>(null);
  const menuBtnRef = useRef<HTMLButtonElement | null>(null);

  const closeDrawer = useCallback(() => {
    setOpen(false);
    // Focus goes back to the button that opened it, not to the top of the page.
    menuBtnRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const body = document.body;
    const previousOverflow = body.style.overflow;
    body.style.overflow = "hidden";

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { closeDrawer(); return; }
      if (e.key !== "Tab") return;
      // Tab must not walk out of the drawer and onto the locked page behind it.
      const focusable = drawerRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      const inside = !!drawerRef.current?.contains(active);
      if (e.shiftKey && (active === first || !inside)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (active === last || !inside)) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKey);

    // Focus follows the drawer in, so the first Tab lands on a nav row rather
    // than somewhere on a page nobody can see.
    const t = window.setTimeout(
      () => drawerRef.current?.querySelector<HTMLElement>("a[href], button")?.focus(),
      0,
    );

    return () => {
      window.removeEventListener("keydown", onKey);
      window.clearTimeout(t);
      body.style.overflow = previousOverflow;
    };
  }, [open, closeDrawer]);

  // Arriving somewhere closes it. Otherwise the drawer sits open over the
  // screen it just navigated to.
  useEffect(() => { setOpen(false); }, [localPath]);

  // The hospital's own logo and name, set by an admin under Settings. Falls back
  // to the built-in mark, so a hospital that never uploads one sees no gap.
  const [brand, setBrand] = useState<{ brandName: string; logoDataUrl: string | null } | null>(null);
  useEffect(() => {
    api.get<{ brandName: string; logoDataUrl: string | null }>("/public/branding")
      .then(setBrand).catch(() => {});
  }, []);
  const brandName = brand?.brandName ?? meta.brand;

  const displayName = me?.name ?? userName;
  const firstName = displayName.split(" ")[0] || displayName;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  async function logout() {
    try { await api.post("/auth/logout"); } catch { /* ignore */ }
    window.location.assign("/login");
  }

  const initials = displayName.split(" ").map((n) => n[0]).slice(0, 2).join("");

  const isActive = (href: string) =>
    href === "/" ? localPath === "/" : localPath.startsWith(href);

  // ── live counts on nav rows ────────────────────────────────────────────────
  // Declared per-portal in nav.ts, fetched here. Re-polled on a slow timer and
  // on tab focus, so a bill raised while the pharmacist was on another screen
  // shows up without them having to reload anything.
  const badgePaths = useMemo(() => {
    const items = meta.groups ? meta.groups.flatMap((g) => g.items) : meta.nav;
    return Array.from(new Set(items.map((i) => i.badge?.path).filter((p): p is string => !!p)));
  }, [meta]);

  /**
   * The union of what actually moves this portal's badges.
   *
   * Empty means "no badge declared events" - then we fall back to reacting to
   * everything, which is the old behaviour and correct for a badge whose author
   * has not thought about it yet.
   */
  const badgeEvents = useMemo(() => {
    const items = meta.groups ? meta.groups.flatMap((g) => g.items) : meta.nav;
    const declared = items.flatMap((i) => i.badge?.events ?? []);
    const everyBadgeNamedItsEvents = items
      .filter((i) => i.badge)
      .every((i) => (i.badge?.events?.length ?? 0) > 0);
    return everyBadgeNamedItsEvents && declared.length > 0
      ? Array.from(new Set(declared))
      : undefined;
  }, [meta]);

  const [badgeData, setBadgeData] = useState<Record<string, Record<string, unknown>>>({});

  const pullBadges = useCallback(async () => {
    if (localPath === "/login" || badgePaths.length === 0) return;
    await Promise.all(badgePaths.map((path) =>
      api.get<Record<string, unknown>>(path)
        .then((r) => setBadgeData((d) => ({ ...d, [path]: r })))
        .catch(() => { /* a badge is never worth an error on screen */ })
    ));
  }, [localPath, badgePaths]);

  useEffect(() => {
    pullBadges();
    // The slow timer stays as the floor. useLive below makes it immediate when
    // the socket is up; this keeps the number honest when it is not.
    const timer = setInterval(pullBadges, 60_000);
    return () => clearInterval(timer);
  }, [pullBadges]);

  // A badge is the one thing on screen a member of staff is meant to ACT on -
  // money not collected, a patient waiting, a test nobody ordered. Up to a
  // minute stale was tolerable when nothing else moved; now that every screen
  // updates live, a lagging badge is the thing that looks broken.
  //
  // meta.key is the portal slug, which is deliberately identical to its topic.
  const portalTopic = isTopic(meta.key) ? [meta.key] : [];
  useLive(portalTopic, pullBadges, {
    events: badgeEvents,
    enabled: portalTopic.length > 0 && localPath !== "/login" && badgePaths.length > 0,
  });

  const badgeCount = (item: NavItem): number => {
    if (!item.badge) return 0;
    const v = badgeData[item.badge.path]?.[item.badge.field];
    return typeof v === "number" ? v : 0;
  };

  const NavRow = ({ item }: { item: NavItem }) => {
    const active = isActive(item.href);
    const count = badgeCount(item);
    return (
      <Link
        href={item.href}
        onClick={() => setOpen(false)}
        title={item.hint}
        className={`group relative flex items-start gap-3 rounded-sm px-3 py-2.5 transition-all duration-200 ${
          active
            ? "bg-[var(--p-nav-active-bg)] text-[var(--p-nav-active-ink)]"
            : "text-[var(--p-nav-row)] hover:bg-[var(--p-nav-active-bg)]/60 hover:text-[var(--p-nav-ink)]"
        }`}
      >
        <span
          className={`absolute left-0 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-full bg-[var(--p-nav-active-ink)] transition-all duration-200 ${
            active ? "opacity-100" : "opacity-0 group-hover:opacity-40"
          }`}
        />
        <span className="mt-[1px] shrink-0"><Icon name={item.icon} size={17} /></span>
        <span className="min-w-0 flex-1">
          <span className={`flex items-center gap-2 text-[13.5px] leading-tight ${active ? "font-semibold" : "font-medium"}`}>
            <span className="min-w-0 truncate">{item.label}</span>
            {count > 0 && (
              <span
                aria-label={`${count} pending`}
                className={`ml-auto shrink-0 rounded-full px-1.5 py-px font-mono text-[10.5px] font-bold leading-[1.5] ${
                  item.badge?.tone === "rose"
                    ? "bg-[var(--p-rose)] text-white"
                    : "bg-[var(--p-amber)] text-white"
                }`}
              >
                {count > 99 ? "99+" : count}
              </span>
            )}
          </span>
          {/* the hint is the teaching: a new receptionist learns the flow by reading the sidebar */}
          {item.hint && (
            <span className="mt-0.5 block text-[11.5px] leading-snug text-[var(--p-nav-muted)]">{item.hint}</span>
          )}
        </span>
      </Link>
    );
  };

  /** Who is signed in, and the two things they do about it. Shared by the rail
   *  and the drawer so the phone is not a second, thinner nav with less on it. */
  const UserCard = () => (
    <div className="mx-3 mb-3 rounded-xl border border-[var(--p-nav-border)] bg-[var(--p-nav-active-bg)] p-3">
      <div className="flex items-center gap-2.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-[var(--p-blue)] to-[var(--p-cyan)] text-[12px] font-semibold text-white">
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium text-[var(--p-nav-ink)]">{displayName}</div>
          <div className="text-[11px] text-[var(--p-nav-muted)]">{meta.roleLabel}</div>
        </div>
      </div>
      <div className="mt-2.5 flex gap-2">
        <button
          onClick={() => { setOpen(false); setSettingsOpen(true); }}
          className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-[var(--p-nav-border)] py-1.5 text-[13px] font-medium text-[var(--p-nav-muted)] transition-colors hover:border-[var(--p-nav-ink)] hover:text-[var(--p-nav-ink)]"
        >
          <Icon name="settings" size={13} /> Settings
        </button>
        <button
          onClick={logout}
          className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-[var(--p-nav-border)] py-1.5 text-[13px] font-medium text-[var(--p-nav-muted)] transition-colors hover:border-[var(--p-rose)]/40 hover:text-[var(--p-rose)]"
        >
          <Icon name="logout" size={13} /> Sign out
        </button>
      </div>
    </div>
  );

  const NavLinks = () => (
    <nav className="flex flex-col gap-4 mt-4 px-3 pb-4">
      {meta.groups
        ? meta.groups.map((g) => {
            const items = g.items.filter((i) => !hidden.has(i.href));
            // A heading with every item hidden under it is a heading for nothing.
            if (items.length === 0) return null;
            return (
              <div key={g.title}>
                <p className="px-3 pb-2 text-[11px] font-bold uppercase tracking-tight border-b border-[var(--p-nav-border)] text-[var(--p-nav-muted)]">
                  {g.title}
                </p>
                <div className="flex flex-col gap-0.5">
                  {items.map((item) => <NavRow key={item.href} item={item} />)}
                </div>
              </div>
            );
          })
        : (
            <div className="flex flex-col gap-0.5">
              {meta.nav.filter((i) => !hidden.has(i.href)).map((item) => <NavRow key={item.href} item={item} />)}
            </div>
          )}
    </nav>
  );

  // The sign-in screen carries its own full-screen layout - no sidebar, no
  // topbar, no drawer. Below every hook on purpose: this component used to
  // return here first and then call another dozen hooks, so navigating from
  // /login into the portal changed the hook count mid-mount.
  if (localPath === "/login") return <>{children}</>;

  return (
    /* data-portal lets one portal carry its own skin without leaking into the
       others - the pharmacy's glass theme is scoped to [data-portal="pharmacy"]. */
    <div className="portal min-h-screen" data-portal={meta.key}>
      {/* Paints the saved accent while this element is still being parsed, so a
          themed portal never flashes the hospital palette for a frame first.
          Reads only its own parent - see lib/portal/theme.ts. */}
      <script dangerouslySetInnerHTML={{ __html: themeBootScript(meta.key) }} />
      <div className="flex min-h-screen">
        {/* ---- Sidebar: frosted glass, light ---- */}
        <aside className="glass navskin sticky top-0 hidden h-screen w-[336px] shrink-0 flex-col border-r border-[var(--p-nav-border)] md:flex">
          <div className="flex items-center gap-2.5 px-6 py-5">
            <BrandMark logo={brand?.logoDataUrl ?? null} name={brandName} />
            <span className="font-serif-p text-[17px] font-semibold text-[var(--p-nav-ink)]">{brandName}</span>
          </div>

          <div className="mb-2 px-6 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--p-nav-muted)]">
            {meta.roleLabel}
          </div>

          <NavLinks />

          <div className="flex-1" />

          <UserCard />
        </aside>

        {/* ---- Main ---- */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* sticky glass topbar - content blurs under it as you scroll */}
          <header className="glass navskin sticky top-0 z-30 flex items-center justify-between border-b border-[var(--p-nav-border)] px-5 py-3.5 md:px-8">
            <div className="flex items-center gap-3">
              <button
                ref={menuBtnRef}
                onClick={() => setOpen((v) => !v)}
                className="rounded-lg border border-[var(--p-nav-border)] p-1.5 text-[var(--p-nav-ink)] md:hidden"
                aria-label="Menu"
                aria-expanded={open}
                aria-controls="portal-nav-drawer"
              >
                <Icon name="grid" size={18} />
              </button>
              <h1 className="font-serif-p text-[19px] font-semibold text-[var(--p-nav-ink)]">{localPath === "/" ? `${greeting}, ${firstName}` : title}</h1>
            </div>

            <div className="flex items-center gap-3">
              {/* one keystroke to anyone, from any screen - the desk's single busiest move */}
              <CommandBar portal={meta.key} />
              <span className="hidden items-center gap-1.5 rounded-full border border-[var(--p-nav-border)] bg-[var(--p-nav-active-bg)] px-3 py-1 text-[12px] font-medium text-[var(--p-nav-muted)] xl:inline-flex">
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--p-cyan)]" />
                Live
              </span>
              <button
                onClick={() => setSettingsOpen(true)}
                aria-label="Settings"
                title="Settings - your account, the accent and the sidebar colours"
                className="rounded-lg border border-[var(--p-nav-border)] bg-[var(--p-nav-active-bg)] p-1.5 text-[var(--p-nav-muted)] transition-colors hover:border-[var(--p-nav-ink)] hover:text-[var(--p-nav-ink)]"
              >
                <Icon name="settings" size={16} />
              </button>
              <div className="hidden text-right sm:block">
                <div className="text-[13px] font-semibold leading-tight text-[var(--p-nav-ink)]">{displayName}</div>
                <div className="text-[11px] text-[var(--p-nav-muted)]">{meta.roleLabel}</div>
              </div>
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-[var(--p-blue)] to-[var(--p-cyan)] text-[13px] font-semibold text-white shadow-[0_4px_12px_-4px_var(--p-blue-glow)]">
                {initials}
              </div>
            </div>
          </header>

          <main className="flex-1 px-5 py-6 md:px-8 md:py-8">{children}</main>
        </div>
      </div>

      {/* ---- Nav drawer, and the locked page behind it (phones) ----
           Both stay mounted so the drawer can slide rather than appear. The
           closed drawer is `inert`: off-screen is not the same as gone, and a
           menu you can still tab into is worse than one that never opened. */}
      <div
        onClick={closeDrawer}
        aria-hidden="true"
        className={`fixed inset-0 z-40 bg-[rgba(9,26,52,0.5)] backdrop-blur-[2px] transition-opacity duration-300 motion-reduce:transition-none md:hidden ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />
      <div
        id="portal-nav-drawer"
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-label={`${brandName} navigation`}
        inert={!open}
        className={`glass navskin fixed inset-y-0 left-0 z-50 flex w-[300px] max-w-[85vw] flex-col border-r border-[var(--p-nav-border)] shadow-[0_20px_60px_-15px_rgba(9,26,52,0.5)] transition-transform duration-300 ease-out will-change-transform motion-reduce:transition-none md:hidden ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between gap-2 px-5 py-4">
          <span className="flex min-w-0 items-center gap-2.5">
            <BrandMark logo={brand?.logoDataUrl ?? null} name={brandName} />
            <span className="truncate font-serif-p text-[16px] font-semibold text-[var(--p-nav-ink)]">{brandName}</span>
          </span>
          <button
            onClick={closeDrawer}
            aria-label="Close menu"
            className="shrink-0 rounded-lg border border-[var(--p-nav-border)] p-1.5 text-[var(--p-nav-muted)] transition-colors hover:text-[var(--p-nav-ink)]"
          >
            <Icon name="x" size={15} />
          </button>
        </div>

        <div className="px-5 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--p-nav-muted)]">
          {meta.roleLabel}
        </div>

        {/* The list is longer than a phone, so THIS scrolls - and only this. */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <NavLinks />
        </div>

        <UserCard />
      </div>

      <SettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        portalKey={meta.key}
        roleLabel={meta.roleLabel}
        me={me}
      />
    </div>
  );
}

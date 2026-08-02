"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/portal/ui/icons";
import {
  THEMES, applyTheme, themeStorageKey,
  NAV_SKINS, applyNav, navVars, navStorageKey, contrastRatio, isHexColor, type NavSkin,
} from "@/lib/portal/theme";

/**
 * Settings - the desk's own two questions: "who am I signed in as?" and "can I
 * make this easier to look at?".
 *
 * A PANEL, NOT A PAGE. Every portal would otherwise need its own /settings
 * route, nav entry and layout branch - five copies of a screen nobody navigates
 * to on purpose. It opens over whatever the person was doing and closes back
 * onto it, which is also what makes the theme picker usable: the colours change
 * live behind the panel, against the real screen being judged, instead of
 * against a preview that is always a lie.
 *
 * The profile half is READ-ONLY, deliberately. Staff accounts are created and
 * corrected by an administrator - that is the access model this whole system is
 * built on (see lib/auth/portals.ts), and a self-service edit here would be a
 * quiet way around it. What this does instead is show people what the hospital
 * holds, so a wrong email is something they can see and report rather than
 * discover when a login code never arrives.
 */

export interface Me {
  name: string; role: string; username: string | null;
  email: string | null; phone: string | null; lastLoginAt: string | null;
}

const ROLE_LABEL: Record<string, string> = {
  ADMIN: "Administrator",
  RECEPTIONIST: "Receptionist",
  DOCTOR: "Doctor",
  LAB_TECH: "Laboratory technician",
  PHARMACIST: "Pharmacist",
  PATIENT: "Patient",
};

/** "01 Aug 2026 · 12:44 PM", or null when the account has never signed in. */
function stamp(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return `${d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })} · ${d
    .toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true })
    .toUpperCase()}`;
}

function Field({ k, v, mono }: { k: string; v: string | null; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-[var(--p-border)] py-2.5 last:border-b-0">
      <span className="shrink-0 text-[12px] text-[var(--p-muted)]">{k}</span>
      <span
        className={`min-w-0 truncate text-right text-[13px] font-medium text-[var(--p-ink)] ${mono ? "font-mono" : ""}`}
        title={v ?? undefined}
      >
        {v || <span className="font-normal italic text-[var(--p-muted)]">Not on file</span>}
      </span>
    </div>
  );
}

/**
 * A colour well plus its hex, kept in step. The native picker is the honest
 * control here - it is the one every operating system already taught people -
 * and the typed hex is for the hospital that was handed a brand colour.
 */
function Swatch({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="min-w-0">
      <span className="block text-[11px] font-semibold uppercase tracking-wide text-[var(--p-muted)]">{label}</span>
      <span className="mt-1.5 flex items-center gap-2 rounded-lg border border-[var(--p-border)] bg-[var(--p-surface)] px-2 py-1.5">
        <input
          type="color" value={value} onChange={(e) => onChange(e.target.value)}
          aria-label={`${label} colour`}
          className="h-6 w-7 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0"
        />
        <input
          value={value} onChange={(e) => onChange(e.target.value)}
          aria-label={`${label} hex`} spellCheck={false} maxLength={7}
          className="w-[76px] bg-transparent font-mono text-[12px] uppercase text-[var(--p-ink)] outline-none"
        />
      </span>
    </label>
  );
}

/** A section heading - the panel's one repeated piece of furniture. */
function Legend({ icon, children, hint }: { icon: "users" | "palette" | "grid"; children: string; hint?: string }) {
  return (
    <>
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--p-muted)]">
        <Icon name={icon} size={13} /> {children}
      </div>
      {hint && <p className="mt-2 text-[11.5px] leading-relaxed text-[var(--p-muted)]">{hint}</p>}
    </>
  );
}

export function SettingsPanel({
  open, onClose, portalKey, roleLabel, me,
}: {
  open: boolean; onClose: () => void; portalKey: string; roleLabel: string; me: Me | null;
}) {
  const [themeId, setThemeId] = useState("default");
  /** The two colours in the pickers. Mirrors what is painted, never leads it. */
  const [nav, setNav] = useState<{ bg: string; ink: string } | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  // The saved choices, read once the panel exists. Both were already painted by
  // the boot script in the shell - this only syncs what shows as selected.
  useEffect(() => {
    try { setThemeId(localStorage.getItem(themeStorageKey(portalKey)) ?? "default"); } catch { /* private mode */ }
    try {
      const raw = localStorage.getItem(navStorageKey(portalKey));
      const saved = raw ? (JSON.parse(raw) as Record<string, string>) : null;
      setNav(saved?.["--p-nav-bg"] && saved["--p-nav-ink"]
        ? { bg: saved["--p-nav-bg"], ink: saved["--p-nav-ink"] }
        : null);
    } catch { /* private mode, or a map written by an older version */ }
  }, [portalKey]);

  // Escape closes, like every other overlay in the portals.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  /** The portal root - the element carrying data-portal, and the only node this
   *  panel can reach. The boot script wrote to the same one. */
  const root = () => panelRef.current?.closest<HTMLElement>("[data-portal]") ?? null;

  function choose(id: string) {
    setThemeId(id);
    applyTheme(root(), id);
    try { localStorage.setItem(themeStorageKey(portalKey), id); } catch { /* private mode */ }
  }

  /**
   * Paint a pair of nav colours, or clear back to the portal's own chrome.
   * Applied live against the real sidebar behind the panel - the whole reason
   * this is a panel and not a page. There is no Save: the screen you are
   * looking at IS the preview, and it is already correct.
   */
  function chooseNav(next: { bg: string; ink: string } | null) {
    setNav(next);
    // Mid-type, "#0b" is not yet a colour. Keep it in the box, keep it off the
    // sidebar - painting every keystroke makes the chrome flicker through
    // whatever the half-written hex happens to mean.
    if (next && !(isHexColor(next.bg) && isHexColor(next.ink))) return;
    const vars = next ? navVars(next.bg, next.ink) : null;
    applyNav(root(), vars);
    try {
      if (vars) localStorage.setItem(navStorageKey(portalKey), JSON.stringify(vars));
      else localStorage.removeItem(navStorageKey(portalKey));
    } catch { /* private mode */ }
  }

  const pickSkin = (s: NavSkin) => chooseNav(s.id === "default" ? null : { bg: s.bg, ink: s.ink });
  /** Which preset the current pair came from, if any - drives the tick. */
  const activeSkinId = nav
    ? NAV_SKINS.find((s) => s.id !== "default" && s.bg === nav.bg && s.ink === nav.ink)?.id ?? "custom"
    : "default";
  const ratio = nav ? contrastRatio(nav.bg, nav.ink) : 21;

  if (!open) return null;

  return (
    <div ref={panelRef} className="modal-veil" onClick={onClose} role="dialog" aria-modal="true" aria-label="Settings">
      <div
        className="surface w-full max-w-5xl overflow-hidden bg-[var(--p-surface)] p-0"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--p-border)] px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            {/* The person, not a generic gear - this panel is mostly about them. */}
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[var(--p-blue)] to-[var(--p-cyan)] text-[12.5px] font-semibold text-white">
              {(me?.name ?? "").split(" ").map((n) => n[0]).slice(0, 2).join("") || "·"}
            </span>
            <div className="min-w-0">
              <h2 className="truncate font-serif-p text-[16px] font-semibold text-[var(--p-ink)]">Settings</h2>
              <p className="truncate text-[11.5px] text-[var(--p-muted)]">
                {me?.name ?? "Signed in"} · {me ? ROLE_LABEL[me.role] ?? roleLabel : roleLabel}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close settings"
            className="shrink-0 rounded-lg border border-[var(--p-border)] p-1.5 text-[var(--p-muted)] transition-colors hover:border-[var(--p-blue)] hover:text-[var(--p-ink)]"
          >
            <Icon name="x" size={15} />
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">
          {/* ── PROFILE ── */}
          <Legend icon="users">Your account</Legend>
          <div className="mt-3 rounded-xl border border-[var(--p-border)] bg-[var(--p-bg)] px-3.5 py-1">
            <Field k="Name" v={me?.name ?? null} />
            <Field k="Role" v={me ? ROLE_LABEL[me.role] ?? roleLabel : null} />
            <Field k="Username" v={me?.username ?? null} mono />
            <Field k="Email" v={me?.email ?? null} />
            <Field k="Phone" v={me?.phone ?? null} mono />
            <Field k="Last signed in" v={stamp(me?.lastLoginAt ?? null)} />
          </div>
          <p className="mt-2.5 text-[11.5px] leading-relaxed text-[var(--p-muted)]">
            Accounts are maintained by the hospital administrator. If any of this is wrong, ask them to correct
            it under Admin → Staff.
          </p>

          {/* ── ACCENT ── */}
          <div className="mt-6 border-t border-[var(--p-border)] pt-5">
            <Legend icon="palette" hint="Changes the accent on this browser only. Warnings, low stock and out-of-range values keep their own colours in every theme.">
              Accent colour
            </Legend>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {THEMES.map((t) => {
              const selected = t.id === themeId;
              return (
                <button
                  key={t.id}
                  onClick={() => choose(t.id)}
                  aria-pressed={selected}
                  className={`flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-all ${
                    selected
                      ? "border-[var(--p-blue)] bg-[var(--p-blue-soft)]"
                      : "border-[var(--p-border)] hover:border-[var(--p-border-strong)]"
                  }`}
                >
                  <span
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-white"
                    style={{ background: t.id === "default" ? "var(--p-blue)" : t.swatch }}
                  >
                    {selected && <Icon name="check" size={11} />}
                  </span>
                  <span className={`min-w-0 truncate text-[12.5px] ${selected ? "font-semibold text-[var(--p-ink)]" : "text-[var(--p-text)]"}`}>
                    {t.label}
                  </span>
                </button>
              );
            })}
          </div>

          {themeId !== "default" && (
            <button
              onClick={() => choose("default")}
              className="mt-3 text-[12px] font-medium text-[var(--p-muted)] underline underline-offset-4 transition-colors hover:text-[var(--p-blue)]"
            >
              Reset to the hospital&apos;s colours
            </button>
          )}

          {/* ── NAVIGATION COLOURS ──────────────────────────────────────────
              The sidebar and topbar only. Everything a patient's data is read
              off - cards, tables, results - is deliberately out of reach. */}
          <div className="mt-6 border-t border-[var(--p-border)] pt-5">
            <Legend icon="grid" hint="The sidebar and the bar across the top. The pages themselves, and every colour that means something clinically, are left alone.">
              Navigation colours
            </Legend>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {NAV_SKINS.map((s) => {
              const selected = s.id === activeSkinId;
              return (
                <button
                  key={s.id}
                  onClick={() => pickSkin(s)}
                  aria-pressed={selected}
                  className={`overflow-hidden rounded-lg border text-left transition-all ${
                    selected ? "border-[var(--p-blue)] ring-2 ring-[var(--p-blue-soft)]" : "border-[var(--p-border)] hover:border-[var(--p-border-strong)]"
                  }`}
                >
                  {/* The swatch is a miniature of the thing itself - two rows of
                      a sidebar - because a dot of colour tells you nothing about
                      what text on it will look like. */}
                  <span className="flex h-[38px] flex-col justify-center gap-[3px] px-2.5" style={{ background: s.bg }}>
                    <span className="flex items-center gap-1.5">
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: s.ink }} />
                      <span className="h-[3px] w-10 rounded-full" style={{ background: s.ink, opacity: 0.8 }} />
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: s.ink, opacity: 0.5 }} />
                      <span className="h-[3px] w-7 rounded-full" style={{ background: s.ink, opacity: 0.45 }} />
                    </span>
                  </span>
                  <span className={`flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] ${selected ? "font-semibold text-[var(--p-ink)]" : "text-[var(--p-text)]"}`}>
                    {selected && <Icon name="check" size={11} />}
                    <span className="min-w-0 truncate">{s.label}</span>
                  </span>
                </button>
              );
            })}
          </div>

          {/* Exact colours, for a hospital whose own two are not on the list. */}
          <div className="mt-3 flex flex-wrap items-end gap-3 rounded-xl border border-[var(--p-border)] bg-[var(--p-bg)] p-3">
            <Swatch
              label="Background"
              value={nav?.bg ?? "#ffffff"}
              onChange={(bg) => chooseNav({ bg, ink: nav?.ink ?? "#091a34" })}
            />
            <Swatch
              label="Text"
              value={nav?.ink ?? "#091a34"}
              onChange={(ink) => chooseNav({ bg: nav?.bg ?? "#ffffff", ink })}
            />
            {activeSkinId === "custom" && (
              <span className="rounded-full bg-[var(--p-blue-soft)] px-2.5 py-1 text-[11px] font-semibold text-[var(--p-blue)]">
                Custom
              </span>
            )}
          </div>

          {/* A warning, never a refusal - the choice stays theirs. */}
          {ratio < 4.5 && (
            <p className="mt-2 flex items-start gap-1.5 text-[11.5px] leading-relaxed text-[var(--p-amber)]">
              <span className="mt-[2px] shrink-0"><Icon name="alert" size={12} /></span>
              <span>
                Those two colours are close together ({ratio.toFixed(1)}:1). Nav labels will be hard to read
                by the end of a shift - {ratio < 3 ? "pick a much darker or much lighter text colour" : "a little more contrast would help"}.
              </span>
            </p>
          )}

          {nav && (
            <button
              onClick={() => chooseNav(null)}
              className="mt-3 text-[12px] font-medium text-[var(--p-muted)] underline underline-offset-4 transition-colors hover:text-[var(--p-blue)]"
            >
              Back to the frosted sidebar
            </button>
          )}
        </div>

        <div className="flex justify-end border-t border-[var(--p-border)] px-5 py-3.5">
          <button
            onClick={onClose}
            className="rounded-lg border border-[var(--p-border)] px-4 py-2 text-[13px] font-medium text-[var(--p-text)] transition-colors hover:border-[var(--p-blue)]"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

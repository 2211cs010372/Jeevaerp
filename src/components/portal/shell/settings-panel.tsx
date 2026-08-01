"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/portal/ui/icons";
import { THEMES, applyTheme, themeStorageKey } from "@/lib/portal/theme";

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

export function SettingsPanel({
  open, onClose, portalKey, roleLabel, me,
}: {
  open: boolean; onClose: () => void; portalKey: string; roleLabel: string; me: Me | null;
}) {
  const [themeId, setThemeId] = useState("default");
  const panelRef = useRef<HTMLDivElement | null>(null);

  // The saved choice, read once the panel exists. The theme itself was already
  // painted by the boot script in the shell - this only syncs which swatch
  // shows as selected.
  useEffect(() => {
    try { setThemeId(localStorage.getItem(themeStorageKey(portalKey)) ?? "default"); } catch { /* private mode */ }
  }, [portalKey]);

  // Escape closes, like every other overlay in the portals.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  function choose(id: string) {
    setThemeId(id);
    // The portal root is the element carrying data-portal; the panel renders
    // inside it, so walking up from here finds the same node the boot script
    // wrote to and nothing else on the page can be reached.
    applyTheme(panelRef.current?.closest<HTMLElement>("[data-portal]") ?? null, id);
    try { localStorage.setItem(themeStorageKey(portalKey), id); } catch { /* private mode */ }
  }

  if (!open) return null;

  return (
    <div ref={panelRef} className="modal-veil" onClick={onClose} role="dialog" aria-modal="true" aria-label="Settings">
      <div
        className="surface w-full max-w-[440px] overflow-hidden bg-[var(--p-surface)] p-0"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--p-border)] px-5 py-4">
          <h2 className="font-serif-p text-[16px] font-semibold text-[var(--p-ink)]">Settings</h2>
          <button
            onClick={onClose}
            aria-label="Close settings"
            className="rounded-lg border border-[var(--p-border)] p-1.5 text-[var(--p-muted)] transition-colors hover:text-[var(--p-ink)]"
          >
            <Icon name="x" size={15} />
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">
          {/* ── PROFILE ── */}
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--p-muted)]">
            <Icon name="users" size={13} /> Your account
          </div>
          <div className="mt-3">
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

          {/* ── APPEARANCE ── */}
          <div className="mt-6 flex items-center gap-2 border-t border-[var(--p-border)] pt-5 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--p-muted)]">
            <Icon name="palette" size={13} /> Accent colour
          </div>
          <p className="mt-2 text-[11.5px] leading-relaxed text-[var(--p-muted)]">
            Changes the accent on this browser only. Warnings, low stock and out-of-range values keep their own
            colours in every theme.
          </p>

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

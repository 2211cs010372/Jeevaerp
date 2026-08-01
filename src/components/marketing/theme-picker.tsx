"use client";

import { useEffect, useRef, useState } from "react";
import { SITE_THEMES, SITE_THEME_KEY, applySiteTheme } from "@/lib/site/theme";

/**
 * The accent picker for the public site.
 *
 * NOT MOUNTED ANYWHERE BY DEFAULT. The theme mechanism works without it - the
 * boot script in the public layout paints whatever is already saved - and where
 * a colour switcher belongs on a hospital's public site is an editorial call,
 * not a technical one. Drop it into the footer, or a staff-only preview page,
 * or nowhere at all.
 *
 * A radiogroup rather than a row of buttons: this is one choice out of five,
 * which is what a radiogroup means, and it gets arrow-key navigation from the
 * browser instead of five separate tab stops.
 *
 * Writes to the same key the boot script reads, and paints by walking up to
 * `.site` - the element the boot script wrote to and the only one it can reach.
 */
export function ThemePicker({ className = "" }: { className?: string }) {
  const [themeId, setThemeId] = useState("default");
  const rootRef = useRef<HTMLDivElement | null>(null);

  // The saved choice, read once mounted. The theme itself was already painted
  // by the boot script - this only syncs which swatch shows as selected.
  useEffect(() => {
    try {
      setThemeId(localStorage.getItem(SITE_THEME_KEY) ?? "default");
    } catch {
      /* private mode */
    }
  }, []);

  function choose(id: string) {
    setThemeId(id);
    applySiteTheme(rootRef.current?.closest<HTMLElement>(".site") ?? null, id);
    try {
      localStorage.setItem(SITE_THEME_KEY, id);
    } catch {
      /* private mode - the colour still applies for this visit */
    }
  }

  return (
    <div ref={rootRef} className={className}>
      <p className="mono text-[10px] uppercase tracking-[0.2em] text-[var(--muted)]">
        Accent
      </p>

      <div
        role="radiogroup"
        aria-label="Site accent colour"
        className="mt-3 flex flex-wrap items-center gap-2"
      >
        {SITE_THEMES.map((t) => {
          const on = t.id === themeId;
          return (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={t.label}
              title={t.label}
              onClick={() => choose(t.id)}
              className={`h-7 w-7 rounded-full border transition-transform duration-200 ${
                on
                  ? "scale-110 border-[var(--ink)]"
                  : "border-[var(--line-strong)] hover:scale-105"
              }`}
              style={{ background: t.swatch }}
            />
          );
        })}
      </div>
    </div>
  );
}

/**
 * Public-site accent themes - the sibling of lib/portal/theme.ts, same rules.
 *
 * WHAT IS THEMEABLE, AND WHAT IS NOT. Only the accent family moves: the teal
 * ramp (--teal*) and the two pine tones the dark chapters are built from
 * (--pine-ink*). The pines are in the set because on this site they ARE the
 * accent's dark form - retheme the teal and leave the pine behind and the
 * "what we believe" chapter suddenly belongs to a different hospital.
 *
 * Everything else stays exactly where site-theme.css put it. The porcelain,
 * the paper, the ink, the hairlines and every semantic colour are load-bearing:
 * --alert is what makes the emergency number read as an emergency number, and
 * that is not a matter of taste in any palette.
 *
 * WHY PER-BROWSER, NOT PER-USER-IN-THE-DATABASE. Same answer as the portal:
 * this is a preference about a screen. The public site has no login to hang it
 * off in the first place, and a marketing site that phones home about a colour
 * choice is a cookie banner waiting to happen.
 *
 * Applied by setting the custom properties directly on the `.site` root, which
 * beats the `.site { … }` block in site-theme.css because an inline style
 * always does. Clearing the properties falls straight back to the hospital's
 * own palette with nothing to undo.
 */

export interface SiteTheme {
  id: string;
  label: string;
  /** The swatch shown in the picker - the accent at full strength. */
  swatch: string;
  /** null = the hospital's own palette, exactly as shipped. */
  vars: Record<string, string> | null;
}

/** Every property a theme is allowed to touch. Also the reset list. */
export const THEMED_VARS = [
  "--teal", "--teal-deep", "--teal-lift", "--teal-soft", "--teal-tint",
  "--pine-ink", "--pine-ink-2",
] as const;

export const SITE_THEMES: SiteTheme[] = [
  {
    id: "default",
    label: "Hospital default",
    swatch: "#0b544c",
    vars: null,
  },
  {
    id: "indigo",
    label: "Indigo",
    swatch: "#3b3fa8",
    vars: {
      "--teal": "#3b3fa8",
      "--teal-deep": "#2b2e80",
      "--teal-lift": "#5257c9",
      "--teal-soft": "#e9eaf5",
      "--teal-tint": "#cdcfe9",
      "--pine-ink": "#171a3a",
      "--pine-ink-2": "#23264e",
    },
  },
  {
    id: "plum",
    label: "Plum",
    swatch: "#7c3a63",
    vars: {
      "--teal": "#7c3a63",
      "--teal-deep": "#5f2b4c",
      "--teal-lift": "#96517c",
      "--teal-soft": "#f4eaf0",
      "--teal-tint": "#e0c8d6",
      "--pine-ink": "#2a1522",
      "--pine-ink-2": "#3c2032",
    },
  },
  {
    id: "slate",
    label: "Graphite",
    swatch: "#334155",
    vars: {
      "--teal": "#334155",
      "--teal-deep": "#1e293b",
      "--teal-lift": "#47566d",
      "--teal-soft": "#ebeef1",
      "--teal-tint": "#cfd6de",
      "--pine-ink": "#161d26",
      "--pine-ink-2": "#232c39",
    },
  },
  {
    id: "ochre",
    label: "Ochre",
    swatch: "#8a5514",
    vars: {
      "--teal": "#8a5514",
      "--teal-deep": "#6b410f",
      "--teal-lift": "#a56a24",
      "--teal-soft": "#f5eee3",
      "--teal-tint": "#e3d2b7",
      "--pine-ink": "#241a0e",
      "--pine-ink-2": "#352816",
    },
  },
];

/** One key for the whole public site - unlike the portals, there is one skin. */
export const SITE_THEME_KEY = "jeeva.theme.site";

export const siteThemeById = (id: string | null | undefined): SiteTheme =>
  SITE_THEMES.find((t) => t.id === id) ?? SITE_THEMES[0];

/** Paint a theme onto the site root. Passing the default clears the overrides. */
export function applySiteTheme(el: HTMLElement | null, id: string): void {
  if (!el) return;
  const vars = siteThemeById(id).vars;
  for (const name of THEMED_VARS) {
    if (vars && vars[name]) el.style.setProperty(name, vars[name]);
    else el.style.removeProperty(name);
  }
}

/**
 * The boot script, inlined into the site root so the saved theme is painted
 * while the HTML is still being parsed.
 *
 * Without this the shell would have to apply the theme in an effect, which runs
 * after first paint - every navigation would flash the hospital's teal for a
 * frame before settling on the chosen one. Worse here than in the portals,
 * because the first thing above the fold is a full-bleed hero built out of
 * exactly these variables.
 *
 * The script is written against the element it sits inside, so it needs no id
 * and cannot touch anything else. Kept deliberately tiny and total: any failure
 * (private mode, storage blocked, an unknown id) leaves the stylesheet's own
 * palette in place, which is the correct fallback rather than an error.
 */
export function siteThemeBootScript(): string {
  const table = JSON.stringify(
    Object.fromEntries(SITE_THEMES.filter((t) => t.vars).map((t) => [t.id, t.vars])),
  );
  return `(function(){try{var e=document.currentScript.parentElement;
var v=(${table})[localStorage.getItem(${JSON.stringify(SITE_THEME_KEY)})];
if(v)for(var k in v)e.style.setProperty(k,v[k]);}catch(_){}})();`;
}

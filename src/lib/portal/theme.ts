/**
 * Portal accent themes - the one thing a desk is allowed to change about how
 * its portal looks.
 *
 * WHAT IS THEMEABLE, AND WHAT IS NOT. Only the accent family moves: the primary
 * (--p-blue*) and the positive/live hue (--p-cyan*). The neutrals, the surfaces,
 * the borders and every semantic colour stay exactly where portal-theme.css put
 * them, because those are what make a pharmacist's stock table and a lab's
 * out-of-range flag readable, and none of that is a matter of taste. Amber still
 * means low stock and rose still means out of range in every theme here.
 *
 * WHY PER-BROWSER, NOT PER-USER-IN-THE-DATABASE. This is a preference about a
 * screen, and the same person at the front desk in the morning and the billing
 * counter at night is looking at two different monitors under two different
 * lights. Storing it on the machine is the honest scope, and it costs the
 * server nothing. It is deliberately NOT synced: a theme that follows a login
 * around is a theme that surprises somebody.
 *
 * Applied by setting the custom properties directly on the portal's root
 * element, which beats the [data-portal="…"] block in portal-theme.css because
 * an inline style always does. Clearing the properties falls straight back to
 * the portal's own palette with nothing to undo.
 */

export interface PortalTheme {
  id: string;
  label: string;
  /** The swatch shown in the picker - the primary at full strength. */
  swatch: string;
  /** null = the portal's own palette, exactly as shipped. */
  vars: Record<string, string> | null;
}

/** Every property a theme is allowed to touch. Also the reset list. */
export const THEMED_VARS = [
  "--p-blue", "--p-blue-deep", "--p-blue-soft", "--p-blue-glow",
  "--p-cyan", "--p-cyan-deep", "--p-cyan-soft",
] as const;

export const THEMES: PortalTheme[] = [
  {
    id: "default",
    label: "Hospital default",
    swatch: "#0b544c",
    vars: null,
  },
  {
    id: "indigo",
    label: "Indigo",
    swatch: "#4338ca",
    vars: {
      "--p-blue": "#4338ca",
      "--p-blue-deep": "#312a9c",
      "--p-blue-soft": "rgba(67, 56, 202, 0.08)",
      "--p-blue-glow": "rgba(67, 56, 202, 0.26)",
      "--p-cyan": "#0e7490",
      "--p-cyan-deep": "#155e75",
      "--p-cyan-soft": "rgba(14, 116, 144, 0.10)",
    },
  },
  {
    id: "teal",
    label: "Teal",
    swatch: "#0f766e",
    vars: {
      "--p-blue": "#0f766e",
      "--p-blue-deep": "#115e56",
      "--p-blue-soft": "rgba(15, 118, 110, 0.08)",
      "--p-blue-glow": "rgba(15, 118, 110, 0.26)",
      "--p-cyan": "#0891b2",
      "--p-cyan-deep": "#0e7490",
      "--p-cyan-soft": "rgba(8, 145, 178, 0.10)",
    },
  },
  {
    id: "plum",
    label: "Plum",
    swatch: "#7c3a63",
    vars: {
      "--p-blue": "#7c3a63",
      "--p-blue-deep": "#5f2b4c",
      "--p-blue-soft": "rgba(124, 58, 99, 0.08)",
      "--p-blue-glow": "rgba(124, 58, 99, 0.26)",
      "--p-cyan": "#9d5f56",
      "--p-cyan-deep": "#7e4a43",
      "--p-cyan-soft": "rgba(157, 95, 86, 0.10)",
    },
  },
  {
    id: "slate",
    label: "Graphite",
    swatch: "#334155",
    vars: {
      "--p-blue": "#334155",
      "--p-blue-deep": "#1e293b",
      "--p-blue-soft": "rgba(51, 65, 85, 0.08)",
      "--p-blue-glow": "rgba(51, 65, 85, 0.24)",
      "--p-cyan": "#0f766e",
      "--p-cyan-deep": "#115e56",
      "--p-cyan-soft": "rgba(15, 118, 110, 0.10)",
    },
  },
  {
    id: "ochre",
    label: "Ochre",
    swatch: "#9a6114",
    vars: {
      "--p-blue": "#9a6114",
      "--p-blue-deep": "#7a4c0f",
      "--p-blue-soft": "rgba(154, 97, 20, 0.08)",
      "--p-blue-glow": "rgba(154, 97, 20, 0.26)",
      "--p-cyan": "#5b7f2f",
      "--p-cyan-deep": "#456123",
      "--p-cyan-soft": "rgba(91, 127, 47, 0.10)",
    },
  },
];

/** Themes are stored per portal - a lab tech and a pharmacist share a machine. */
export const themeStorageKey = (portalKey: string) => `jeeva.theme.${portalKey}`;

export const themeById = (id: string | null | undefined): PortalTheme =>
  THEMES.find((t) => t.id === id) ?? THEMES[0];

/** Paint a theme onto a portal root. Passing the default clears the overrides. */
export function applyTheme(el: HTMLElement | null, id: string): void {
  if (!el) return;
  const vars = themeById(id).vars;
  for (const name of THEMED_VARS) {
    if (vars && vars[name]) el.style.setProperty(name, vars[name]);
    else el.style.removeProperty(name);
  }
}

/**
 * The boot script, inlined into the portal root so the saved theme is painted
 * while the HTML is still being parsed.
 *
 * Without this the shell would have to apply the theme in an effect, which runs
 * after first paint - every navigation would flash the hospital's palette for a
 * frame before settling on the chosen one. The script is written against the
 * element it sits inside, so it needs no id and cannot touch anything else.
 *
 * Kept deliberately tiny and total: any failure (private mode, storage blocked,
 * an unknown id) leaves the stylesheet's own palette in place, which is the
 * correct fallback rather than an error.
 */
export function themeBootScript(portalKey: string): string {
  const table = JSON.stringify(
    Object.fromEntries(THEMES.filter((t) => t.vars).map((t) => [t.id, t.vars])),
  );
  return `(function(){try{var e=document.currentScript.parentElement;
var v=(${table})[localStorage.getItem(${JSON.stringify(themeStorageKey(portalKey))})];
if(v)for(var k in v)e.style.setProperty(k,v[k]);}catch(_){}})();`;
}

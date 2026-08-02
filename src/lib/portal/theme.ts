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
    /**
     * The house palette - the pine the public site's Trust section is built on
     * (--teal / --teal-deep / --teal-lift in site-theme.css). The one theme
     * here that is not a matter of taste: it puts a staff portal in the same
     * colours a patient just saw on the website.
     */
    id: "house",
    label: "Trust page",
    swatch: "#0b544c",
    vars: {
      "--p-blue": "#0b544c",
      "--p-blue-deep": "#073d37",
      "--p-blue-soft": "rgba(11, 84, 76, 0.08)",
      "--p-blue-glow": "rgba(11, 84, 76, 0.26)",
      "--p-cyan": "#17705f",
      "--p-cyan-deep": "#0f5a4c",
      "--p-cyan-soft": "rgba(23, 112, 95, 0.10)",
    },
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

/* ══════════════════════════════════════════════════════════════════════════
   NAV SKIN - the sidebar and topbar, as two colours.
   ══════════════════════════════════════════════════════════════════════════

   Separate from the accent above, because it answers a different question. The
   accent asks "what colour is a button"; this asks "how dark is the rail I
   stare past all day". A ward terminal under tube lights and a billing counter
   beside a window want opposite answers, and neither is a brand decision.

   Only the chrome moves. The page itself, every card, every table and every
   semantic colour stay exactly as portal-theme.css shipped them - a dark
   sidebar must never become a dark stock table, because the numbers on it are
   read at speed by somebody who cannot afford to squint.

   Two colours are the whole model: a background and a text colour. Everything
   else the chrome needs - the muted line under a nav row, the hairline, the
   active row's tint - is DERIVED from the text colour at low alpha, so it
   lands correctly on any background the user picks without asking them to
   choose six things they cannot picture. */

/** Every property a nav skin writes. Also the reset list. */
export const NAV_VARS = [
  "--p-nav-bg", "--p-nav-ink", "--p-nav-row", "--p-nav-muted",
  "--p-nav-border", "--p-nav-active-bg", "--p-nav-active-ink",
] as const;

export interface NavSkin {
  id: string;
  label: string;
  /** Shown in the picker. For `default` these only describe the shipped look. */
  bg: string;
  ink: string;
}

export const NAV_SKINS: NavSkin[] = [
  { id: "default", label: "Frosted white", bg: "#ffffff", ink: "#091a34" },
  /* The house palette, both ways round. The Trust section is white cells on a
     bone ground with the pine spent in exactly ONE filled cell - which is the
     same choice a sidebar makes: it is either the quiet ground everything else
     sits on, or it is the one filled block on the screen. */
  { id: "trust-bone", label: "Trust bone", bg: "#eef1ef", ink: "#0c1a1c" },
  { id: "trust-pine", label: "Trust pine", bg: "#0b544c", ink: "#ffffff" },
  { id: "midnight", label: "Midnight", bg: "#0b1b33", ink: "#e9effb" },
  { id: "forest", label: "Forest", bg: "#0d2f28", ink: "#e3f2ec" },
  { id: "graphite", label: "Graphite", bg: "#1e2733", ink: "#e7ecf4" },
  { id: "bone", label: "Bone", bg: "#f2eee6", ink: "#2c2a22" },
  { id: "sky", label: "Sky", bg: "#e6eefd", ink: "#12305f" },
];

/** A COMPLETE colour. A hex being typed one character at a time is not one. */
export const isHexColor = (v: string) => /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v.trim());

/** "#0b1b33" or "#abc" -> [r,g,b]. null for anything we can't read. */
function toRgb(hex: string): [number, number, number] | null {
  const raw = hex.trim().replace(/^#/, "");
  const s = raw.length === 3 ? raw.split("").map((c) => c + c).join("") : raw;
  if (!/^[0-9a-f]{6}$/i.test(s)) return null;
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
}

/**
 * The six chrome properties, derived from the two the user actually picked.
 * The alphas are over the chosen background, so a pale rail and a near-black
 * one both end up with a hairline you can see and a row tint you can't quite.
 */
export function navVars(bg: string, ink: string): Record<string, string> {
  const rgb = toRgb(ink) ?? [9, 26, 52];
  const a = (alpha: number) => `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
  return {
    "--p-nav-bg": bg,
    "--p-nav-ink": ink,
    "--p-nav-row": a(0.78),
    "--p-nav-muted": a(0.55),
    "--p-nav-border": a(0.16),
    "--p-nav-active-bg": a(0.13),
    "--p-nav-active-ink": ink,
  };
}

/**
 * WCAG contrast ratio, 1 to 21. Used to warn - never to forbid: a hospital
 * that wants its own two colours gets them, and is simply told when the pair
 * is going to be hard to read at the end of a shift.
 * An unreadable input returns 21, so a half-typed hex never raises an alarm.
 */
export function contrastRatio(a: string, b: string): number {
  const x = toRgb(a), y = toRgb(b);
  if (!x || !y) return 21;
  const lum = ([r, g, b2]: [number, number, number]) => {
    const f = (v: number) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b2);
  };
  const [hi, lo] = [lum(x), lum(y)].sort((m, n) => n - m);
  return (hi + 0.05) / (lo + 0.05);
}

/** Themes are stored per portal - a lab tech and a pharmacist share a machine. */
export const themeStorageKey = (portalKey: string) => `jeeva.theme.${portalKey}`;
/** Same reasoning, same scope - the nav skin belongs to the screen. */
export const navStorageKey = (portalKey: string) => `jeeva.nav.${portalKey}`;

/**
 * Paint a nav skin onto a portal root, or strip it back to the frosted
 * default. The marker attribute is what the stylesheet keys off: without it
 * every portal keeps the exact glass chrome it shipped with, so this feature
 * is invisible until somebody chooses to use it.
 */
export function applyNav(el: HTMLElement | null, vars: Record<string, string> | null): void {
  if (!el) return;
  for (const name of NAV_VARS) {
    if (vars && vars[name]) el.style.setProperty(name, vars[name]);
    else el.style.removeProperty(name);
  }
  if (vars) el.setAttribute("data-navskin", "1");
  else el.removeAttribute("data-navskin");
}

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
  // The nav skin is stored already-derived - a map of properties - so this
  // stays a loop rather than shipping the colour maths into an inline script.
  return `(function(){try{var e=document.currentScript.parentElement;
var v=(${table})[localStorage.getItem(${JSON.stringify(themeStorageKey(portalKey))})];
if(v)for(var k in v)e.style.setProperty(k,v[k]);
var n=localStorage.getItem(${JSON.stringify(navStorageKey(portalKey))});
if(n){n=JSON.parse(n);for(var j in n)e.style.setProperty(j,n[j]);e.setAttribute('data-navskin','1');}
}catch(_){}})();`;
}

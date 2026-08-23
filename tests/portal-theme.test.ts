import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import {
  NAV_VARS, NAV_SKINS, navVars, contrastRatio, isHexColor,
  navStorageKey, themeBootScript,
} from "@/lib/portal/theme";

/**
 * The nav skin is two colours the user picks and five the code derives. The
 * derivation is the part nobody can eyeball - a hairline at the wrong alpha is
 * invisible on one background and a hard line on another - so it is pinned here.
 */

describe("a colour is only a colour once it is finished being typed", () => {
  it("accepts both hex lengths, with or without the hash", () => {
    for (const v of ["#fff", "#ffffff", "fff", "0b1b33", "#0B1B33"]) {
      expect(isHexColor(v), v).toBe(true);
    }
  });

  it("rejects a hex mid-keystroke, so the sidebar never flashes", () => {
    for (const v of ["#", "#0", "#0b", "#0b1b3", "", "rebeccapurple", "#gggggg"]) {
      expect(isHexColor(v), v).toBe(false);
    }
  });
});

describe("the five derived chrome properties", () => {
  it("writes every property the reset list clears", () => {
    const vars = navVars("#0b1b33", "#e9effb");
    // applyNav walks NAV_VARS to paint AND to strip. A property produced here
    // but missing there would be a colour that survives "back to frosted".
    expect(Object.keys(vars).sort()).toEqual([...NAV_VARS].sort());
  });

  it("passes the two chosen colours through untouched", () => {
    const vars = navVars("#0b1b33", "#e9effb");
    expect(vars["--p-nav-bg"]).toBe("#0b1b33");
    expect(vars["--p-nav-ink"]).toBe("#e9effb");
  });

  it("derives the rest from the TEXT colour, so they land on any background", () => {
    const vars = navVars("#0b1b33", "#ffffff");
    // white text -> every derived tint is white at some alpha
    expect(vars["--p-nav-row"]).toBe("rgba(255, 255, 255, 0.78)");
    expect(vars["--p-nav-muted"]).toBe("rgba(255, 255, 255, 0.55)");
    expect(vars["--p-nav-border"]).toBe("rgba(255, 255, 255, 0.16)");
    expect(vars["--p-nav-active-bg"]).toBe("rgba(255, 255, 255, 0.13)");
  });

  it("reads short hex the same as long", () => {
    expect(navVars("#000", "#fff")["--p-nav-border"]).toBe(navVars("#000000", "#ffffff")["--p-nav-border"]);
  });

  it("falls back to the ink default rather than emitting NaN", () => {
    const vars = navVars("#0b1b33", "not-a-colour");
    expect(vars["--p-nav-border"]).not.toMatch(/NaN/);
  });
});

describe("the contrast warning", () => {
  it("puts black on white at the top of the scale", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 1);
  });

  it("puts a colour on itself at the bottom", () => {
    expect(contrastRatio("#3b7a5a", "#3b7a5a")).toBeCloseTo(1, 5);
  });

  it("is symmetric - neither argument is 'the background'", () => {
    expect(contrastRatio("#0b1b33", "#e9effb")).toBeCloseTo(contrastRatio("#e9effb", "#0b1b33"), 10);
  });

  it("stays silent on a half-typed hex instead of crying wolf", () => {
    // 21 is the "no warning" answer - a warning while someone is still typing
    // would fire on nearly every keystroke.
    expect(contrastRatio("#0b", "#ffffff")).toBe(21);
  });

  it("clears 4.5:1 for every shipped preset", () => {
    for (const s of NAV_SKINS) {
      expect(contrastRatio(s.bg, s.ink), s.label).toBeGreaterThan(4.5);
    }
  });
});

describe("the boot script's contract with the panel", () => {
  it("reads the same storage key the panel writes", () => {
    expect(themeBootScript("reception")).toContain(navStorageKey("reception"));
  });

  it("is scoped to the portal it was generated for", () => {
    expect(themeBootScript("pharmacy")).not.toContain(navStorageKey("reception"));
  });
});

/**
 * THE ONE CSS RULE THAT CAN SILENTLY DELETE THE PHONE NAV.
 *
 * portal-theme.css is unlayered, and unlayered CSS beats every LAYERED rule no
 * matter the specificity - including all of Tailwind's utilities, which v4 puts
 * in `@layer utilities`. So an unlayered `.portal > *` setting `position` and
 * `z-index` overrides `fixed` and `z-50` on every DIRECT child of .portal.
 *
 * The nav drawer and its scrim are direct children. Unlayered, that rule laid
 * them out as `position: relative; z-index: 1` - a 300px block at the bottom of
 * the document, translated off-screen - so on every portal, on every phone,
 * tapping Menu did nothing at all. Nothing throws, nothing logs; the navigation
 * is just gone.
 *
 * Wrapping it in `@layer base` puts it behind the utilities, which is the right
 * way round: a component that asks for `fixed` means it. This pins that.
 */
describe("the portal stacking rule stays out of the utilities' way", () => {
  const css = readFileSync(
    path.resolve(__dirname, "../src/app/portal-theme.css"),
    "utf8",
  );
  /** Brace depth at an index, with comments removed so their braces don't count. */
  const depthAt = (source: string, index: number) =>
    source.slice(0, index).split("{").length - source.slice(0, index).split("}").length;
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");

  it("still lifts portal content off the aurora", () => {
    expect(bare).toMatch(/\.portal\s*>\s*\*\s*\{[^}]*z-index:\s*1/);
  });

  it("declares that lift inside a cascade layer, not at the top level", () => {
    const i = bare.search(/\.portal\s*>\s*\*/);
    expect(i, "the .portal > * rule went missing").toBeGreaterThan(-1);
    // Depth 0 means unlayered, which beats Tailwind's `fixed` and kills the
    // phone drawer on all six portals.
    expect(depthAt(bare, i)).toBe(1);
  });

  it("puts it in `base`, which Tailwind orders before `utilities`", () => {
    const i = bare.search(/\.portal\s*>\s*\*/);
    expect(bare.lastIndexOf("@layer", i)).toBeGreaterThan(-1);
    expect(bare.slice(bare.lastIndexOf("@layer", i), i)).toMatch(/^@layer\s+base\s*\{/);
  });
});

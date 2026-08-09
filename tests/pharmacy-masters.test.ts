import { describe, it, expect } from "vitest";
import {
  MASTER_KINDS, MASTER_META, resolveMaster, masterValue, effectiveGstRate,
} from "@/lib/pharmacy/masters";

describe("resolveMaster - prefer the master, fall back to the string", () => {
  it("uses the master when it is set", () => {
    expect(resolveMaster("Cipla", "CIPLA")).toEqual({ value: "Cipla", source: "master" });
  });

  it("falls back to the legacy string when no master is linked", () => {
    expect(resolveMaster(null, "Cipla Ltd")).toEqual({ value: "Cipla Ltd", source: "legacy" });
    expect(resolveMaster(undefined, "Cipla Ltd").source).toBe("legacy");
  });

  it("reports nothing when neither side has a value", () => {
    expect(resolveMaster(null, null)).toEqual({ value: null, source: "none" });
    expect(resolveMaster(undefined, undefined).value).toBeNull();
  });

  it("treats whitespace-only as absent on both sides", () => {
    // A column holding " " is not data. Letting it beat a real master row
    // would be the worst of both worlds.
    expect(resolveMaster("   ", "Cipla")).toEqual({ value: "Cipla", source: "legacy" });
    expect(resolveMaster(null, "   ")).toEqual({ value: null, source: "none" });
    expect(resolveMaster("  ", "  ")).toEqual({ value: null, source: "none" });
  });

  it("trims what it returns, from either side", () => {
    expect(resolveMaster("  Cipla  ", null).value).toBe("Cipla");
    expect(resolveMaster(null, "  Cipla Ltd  ").value).toBe("Cipla Ltd");
  });

  it("masterValue is the same rule without the provenance", () => {
    expect(masterValue("Cipla", "CIPLA")).toBe("Cipla");
    expect(masterValue(null, "CIPLA")).toBe("CIPLA");
    expect(masterValue(null, null)).toBeNull();
  });

  it("never invents a value that was in neither column", () => {
    for (const [m, l] of [[null, null], ["", ""], ["  ", null], [undefined, ""]] as const) {
      expect(resolveMaster(m, l).value).toBeNull();
    }
  });
});

describe("effectiveGstRate - the product's own rate stays the authority", () => {
  it("returns the medicine's rate, not the HSN's", () => {
    const r = effectiveGstRate({ medicineRatePct: 12, hsnDefaultRatePct: 5 });
    // The HSN does NOT override. A master edit must never silently reprice.
    expect(r.ratePct).toBe(12);
  });

  it("flags a disagreement with the classification rather than resolving it", () => {
    const r = effectiveGstRate({ medicineRatePct: 12, hsnDefaultRatePct: 5 });
    expect(r.disagreesWithHsn).toBe(true);
    expect(r.hsnRatePct).toBe(5);
  });

  it("is quiet when they agree", () => {
    expect(effectiveGstRate({ medicineRatePct: 5, hsnDefaultRatePct: 5 }).disagreesWithHsn).toBe(false);
  });

  it("is quiet when the medicine has no HSN linked", () => {
    const r = effectiveGstRate({ medicineRatePct: 5, hsnDefaultRatePct: null });
    expect(r.disagreesWithHsn).toBe(false);
    expect(r.hsnRatePct).toBeNull();
    expect(r.ratePct).toBe(5);
  });

  it("does not trip on floating point noise", () => {
    expect(effectiveGstRate({ medicineRatePct: 5.0, hsnDefaultRatePct: 5.0000001 }).disagreesWithHsn).toBe(false);
  });

  it("treats 0% as a real rate, not as missing", () => {
    const r = effectiveGstRate({ medicineRatePct: 0, hsnDefaultRatePct: 5 });
    expect(r.ratePct).toBe(0);
    expect(r.disagreesWithHsn).toBe(true);
  });
});

describe("master registry", () => {
  it("every kind has display metadata", () => {
    for (const k of MASTER_KINDS) {
      expect(MASTER_META[k]).toBeDefined();
      expect(MASTER_META[k].title.length).toBeGreaterThan(0);
      expect(MASTER_META[k].singular.length).toBeGreaterThan(0);
      expect(["name", "code"]).toContain(MASTER_META[k].labelField);
    }
  });

  it("covers the eight masters that were migrated", () => {
    expect([...MASTER_KINDS].sort()).toEqual(
      ["category", "dosageForm", "generic", "hsn", "manufacturer", "schedule", "tax", "unit"]
    );
  });

  it("the schedule master says plainly that nothing is auto-filled", () => {
    // Guards the compliance promise made in the migration.
    expect(MASTER_META.schedule.blurb).toMatch(/never|automatic/i);
  });
});

import { describe, it, expect } from "vitest";
import {
  DISCHARGE_TYPE_OPTIONS,
  parseDischargeType,
  formatDischargeType,
} from "@/components/portal/ipd/discharge-summary-form";

describe("Discharge Type options and parser", () => {
  it("includes all requested discharge types", () => {
    expect(DISCHARGE_TYPE_OPTIONS).toContain("Normal Discharge");
    expect(DISCHARGE_TYPE_OPTIONS).toContain("Lama Discharge");
    expect(DISCHARGE_TYPE_OPTIONS).toContain("Refer to");
    expect(DISCHARGE_TYPE_OPTIONS).toContain("Death");
  });

  it("parses empty or null into Normal Discharge default", () => {
    expect(parseDischargeType(null)).toEqual({ type: "Normal Discharge", details: "" });
    expect(parseDischargeType("")).toEqual({ type: "Normal Discharge", details: "" });
    expect(parseDischargeType("   ")).toEqual({ type: "Normal Discharge", details: "" });
  });

  it("parses standard types correctly", () => {
    expect(parseDischargeType("Normal Discharge")).toEqual({ type: "Normal Discharge", details: "" });
    expect(parseDischargeType("Lama Discharge")).toEqual({ type: "Lama Discharge", details: "" });
    expect(parseDischargeType("Death")).toEqual({ type: "Death", details: "" });
    expect(parseDischargeType("Expired")).toEqual({ type: "Death", details: "" });
  });

  it("parses 'Refer to' with and without destination", () => {
    expect(parseDischargeType("Refer to")).toEqual({ type: "Refer to", details: "" });
    expect(parseDischargeType("Refer to: NIMS Hospital")).toEqual({ type: "Refer to", details: "NIMS Hospital" });
    expect(parseDischargeType("Refer to - Higher Center")).toEqual({ type: "Refer to", details: "Higher Center" });
  });

  it("formats discharge type appropriately", () => {
    expect(formatDischargeType("Normal Discharge", "")).toBe("Normal Discharge");
    expect(formatDischargeType("Lama Discharge", "")).toBe("Lama Discharge");
    expect(formatDischargeType("Death", "")).toBe("Death");
    expect(formatDischargeType("Refer to", "")).toBe("Refer to");
    expect(formatDischargeType("Refer to", "NIMS Hospital")).toBe("Refer to: NIMS Hospital");
  });
});

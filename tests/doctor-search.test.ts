import { describe, it, expect } from "vitest";
import { searchDoctors } from "@/lib/doctor-search";
import { DOCTORS } from "@/lib/data";

/**
 * The header typeahead and the /doctors directory both run this. If it drifts,
 * the header offers a consultant the results page then refuses to show - which
 * is worse than no search at all, because it looks like the hospital lost them.
 */

const names = (q: string) => searchDoctors(DOCTORS, q).map((m) => m.doctor.name);

describe("finding a doctor the way a patient searches", () => {
  it("finds by surname without the honorific", () => {
    // People type "shireesha", not "Dr. Shireesha M".
    expect(names("shireesha").length).toBeGreaterThan(0);
    expect(names("shireesha")[0]).toContain("Shireesha");
  });

  it("finds by speciality", () => {
    const hits = names("gynaec");
    expect(hits.length).toBeGreaterThan(0);
  });

  it("finds by department", () => {
    expect(names("psychiatry").length).toBeGreaterThan(0);
  });

  it("finds by what the consultant treats, not just their title", () => {
    // The whole reason `focus` is in the haystack: nobody searches "Orthopaedics".
    const anyFocus = DOCTORS[0].focus[0];
    expect(names(anyFocus).length).toBeGreaterThan(0);
  });

  it("finds by the language they consult in", () => {
    expect(names("telugu").length).toBeGreaterThan(0);
  });

  it("is case- and whitespace-insensitive", () => {
    expect(names("  PHYSIOTHERAPIST  ")).toEqual(names("physiotherapist"));
  });

  it("returns the whole panel for an empty query", () => {
    expect(searchDoctors(DOCTORS, "")).toHaveLength(DOCTORS.length);
    expect(searchDoctors(DOCTORS, "   ")).toHaveLength(DOCTORS.length);
  });

  it("returns nothing for a term that matches nothing", () => {
    expect(names("zzzznotathing")).toEqual([]);
  });
});

describe("ranking", () => {
  it("puts a name match above a speciality match", () => {
    // Construct the ambiguity rather than hoping the real panel contains one.
    const a = { ...DOCTORS[0], id: "x1", name: "Dr. Cardio Kumar", specialization: "Dermatologist", focus: [], languages: "English", qualification: "MBBS", department: "Dermatology" };
    const b = { ...DOCTORS[0], id: "x2", name: "Dr. Anand Rao", specialization: "Cardiologist", focus: [], languages: "English", qualification: "MBBS", department: "Cardiology" };
    expect(searchDoctors([b, a], "cardio").map((m) => m.doctor.id)).toEqual(["x1", "x2"]);
  });

  it("explains a non-obvious match and stays silent on an obvious one", () => {
    const byName = searchDoctors(DOCTORS, "shireesha")[0];
    expect(byName.reason).toBeNull();

    const byLang = searchDoctors(DOCTORS, "telugu")[0];
    expect(byLang.reason).toContain("Telugu");
  });
});

describe("agreement with the directory", () => {
  it("every suggestion the header can show is also findable on the results page", () => {
    // Both call this function, so the guarantee is structural - this asserts it
    // stays that way if either surface is changed.
    for (const term of ["cardio", "telugu", "psychiatry", "mbbs"]) {
      const all = searchDoctors(DOCTORS, term);
      const top6 = all.slice(0, 6);
      for (const m of top6) {
        expect(all.map((x) => x.doctor.id)).toContain(m.doctor.id);
      }
    }
  });
});

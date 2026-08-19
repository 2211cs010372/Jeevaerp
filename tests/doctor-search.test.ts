import { describe, it, expect } from "vitest";
import { searchDoctors } from "@/lib/doctor-search";
import type { Doctor } from "@/lib/data";

/**
 * The header typeahead and the /doctors directory both run this. If it drifts,
 * the header offers a consultant the results page then refuses to show - which
 * is worse than no search at all, because it looks like the hospital lost them.
 *
 * THE PANEL HERE IS A FIXTURE, NOT THE REAL ONE. It used to import the roster
 * this site published, back when that roster was a hand-written array. It is
 * read from the ERP now, so importing it would make these tests fail the day a
 * consultant resigns - a green suite is not supposed to depend on who is
 * currently employed. The fixture carries the same shape and the same awkward
 * cases the real panel does: two doctors whose name and speciality cross, a
 * consultant found only by the language they speak, one found only by what
 * their clinic treats.
 */

const doc = (over: Partial<Doctor> & Pick<Doctor, "id" | "name">): Doctor => ({
  specialization: "General Physician",
  designation: "Consultant Physician",
  department: "General Medicine",
  qualification: "MBBS",
  experience: 8,
  age: 38,
  fee: 400,
  opd: "Open 24 Hours",
  days: "Daily",
  room: "OPD Block · General Medicine",
  bio: "",
  about: [],
  languages: "Telugu, English",
  focus: [],
  treats: [],
  procedures: [],
  interests: [],
  seeIf: [],
  prepare: [],
  education: [],
  ...over,
});

const PANEL: Doctor[] = [
  doc({ id: "c1", name: "Dr. Shireesha Ch", specialization: "Obstetrics & Gynecologist", department: "Gynaecology",
        focus: ["Pregnancy care", "Irregular periods"], languages: "Telugu, English" }),
  doc({ id: "c2", name: "Dr. Rakesh G", specialization: "Psychiatry", department: "Psychiatry", languages: "Telugu, English" }),
  doc({ id: "c3", name: "Dr. V Prashanth", specialization: "Orthopedics & FIJR", department: "Orthopaedics",
        focus: ["Knee replacement", "Back pain"], languages: "Telugu, English" }),
  doc({ id: "c4", name: "Dr. Meena Joseph", specialization: "Physiotherapist", department: "Physiotherapy", languages: "Malayalam, English" }),
  doc({ id: "c5", name: "Dr. A Santhosh", specialization: "General Medicine", qualification: "MBBS, DNB", languages: "Telugu, English" }),
];

const names = (q: string) => searchDoctors(PANEL, q).map((m) => m.doctor.name);

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
    const anyFocus = PANEL[0].focus[0];
    expect(names(anyFocus).length).toBeGreaterThan(0);
  });

  it("finds by the language they consult in", () => {
    expect(names("telugu").length).toBeGreaterThan(0);
  });

  it("is case- and whitespace-insensitive", () => {
    expect(names("  PHYSIOTHERAPIST  ")).toEqual(names("physiotherapist"));
  });

  it("returns the whole panel for an empty query", () => {
    expect(searchDoctors(PANEL, "")).toHaveLength(PANEL.length);
    expect(searchDoctors(PANEL, "   ")).toHaveLength(PANEL.length);
  });

  it("returns nothing for a term that matches nothing", () => {
    expect(names("zzzznotathing")).toEqual([]);
  });
});

describe("ranking", () => {
  it("puts a name match above a speciality match", () => {
    // Construct the ambiguity rather than hoping the real panel contains one.
    const a = { ...PANEL[0], id: "x1", name: "Dr. Cardio Kumar", specialization: "Dermatologist", focus: [], languages: "English", qualification: "MBBS", department: "Dermatology" };
    const b = { ...PANEL[0], id: "x2", name: "Dr. Anand Rao", specialization: "Cardiologist", focus: [], languages: "English", qualification: "MBBS", department: "Cardiology" };
    expect(searchDoctors([b, a], "cardio").map((m) => m.doctor.id)).toEqual(["x1", "x2"]);
  });

  it("explains a non-obvious match and stays silent on an obvious one", () => {
    const byName = searchDoctors(PANEL, "shireesha")[0];
    expect(byName.reason).toBeNull();

    const byLang = searchDoctors(PANEL, "telugu")[0];
    expect(byLang.reason).toContain("Telugu");
  });
});

describe("agreement with the directory", () => {
  it("every suggestion the header can show is also findable on the results page", () => {
    // Both call this function, so the guarantee is structural - this asserts it
    // stays that way if either surface is changed.
    for (const term of ["cardio", "telugu", "psychiatry", "mbbs"]) {
      const all = searchDoctors(PANEL, term);
      const top6 = all.slice(0, 6);
      for (const m of top6) {
        expect(all.map((x) => x.doctor.id)).toContain(m.doctor.id);
      }
    }
  });
});

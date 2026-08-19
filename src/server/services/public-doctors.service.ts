import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { DEPARTMENTS, type Credential, type Doctor } from "@/lib/data";

/**
 * THE PUBLIC CONSULTING PANEL, READ FROM THE ERP.
 *
 * This used to be a hand-written array of fifteen consultants in lib/data.ts,
 * maintained beside the fifteen in the Doctor table - and not one name matched
 * between them. The site advertised "Dr. Shireesha M"; the hospital employs
 * "Dr. Shireesha Ch". Two consequences, both live:
 *
 *   1. Every "request a callback" naming a doctor was rejected. The form sent
 *      the marketing roster's `id`, which was the invented NAME, into a lookup
 *      on Doctor.id, which is a cuid. It could never match, so the patient got
 *      "That doctor isn't available. Pick another, or leave it blank." The desk
 *      never saw the request and nobody rang back.
 *   2. Editing a doctor in reception changed nothing a patient could see.
 *
 * So the roster now has one source, and it is the one the hospital actually
 * runs on. Add a consultant at the reception desk and they are on the website;
 * mark them inactive and they are off it.
 *
 * WHAT THIS FILE WILL NOT DO IS INVENT. The old array carried paragraphs of
 * biography, lists of procedures and named credentials for people who had never
 * supplied any of it. The rule already written into lib/data.ts - describe the
 * practice, never the person's history - is enforced here by having nowhere to
 * put a claim the ERP cannot back. What each doctor genuinely has (name,
 * speciality, department, degrees, years, languages, fee, consulting hours)
 * comes from their record. What is true of the CLINIC rather than the person
 * (what it sees, what to bring) comes from the department. Everything else is
 * left empty, and the profile page skips the section.
 */

/** 0 = Sunday, matching DoctorSchedule.dayOfWeek. */
const DAY_LABEL = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * What the degrees after a name actually mean.
 *
 * These describe the QUALIFICATION, not the doctor - "MD means three years of
 * postgraduate training" is true of every MD in the country. So the dictionary
 * is safe where a hand-written credential list was not: it explains a degree
 * the ERP records, rather than attributing one nobody entered.
 *
 * Keys are normalised - dots stripped, uppercased - because the same degree is
 * typed at the desk as "M.B.B.S", "MBBS" and "M.B.B.S," in the same afternoon.
 */
const DEGREE_MEANING: Record<string, string> = {
  MBBS: "Bachelor of Medicine and Bachelor of Surgery - the primary medical degree, five and a half years including internship.",
  MD: "Doctor of Medicine - three years of postgraduate training in a chosen speciality.",
  MS: "Master of Surgery - three years of postgraduate surgical training.",
  DNB: "Diplomate of National Board - a postgraduate qualification equivalent to an MD or MS, awarded by the National Board of Examinations.",
  DM: "Doctorate of Medicine - the super-speciality degree taken after an MD, usually three further years.",
  MCH: "Magister Chirurgiae - the super-speciality surgical degree taken after an MS, usually three further years.",
  DGO: "Diploma in Obstetrics and Gynaecology - two years of postgraduate training in women's health.",
  DCH: "Diploma in Child Health - two years of postgraduate training in paediatrics.",
  DA: "Diploma in Anaesthesiology - two years of postgraduate training in anaesthesia.",
  DLO: "Diploma in Laryngology and Otology - two years of postgraduate training in ENT.",
  DORTHO: "Diploma in Orthopaedics - two years of postgraduate training in bone and joint care.",
  FRCS: "Fellow of the Royal College of Surgeons - a surgical fellowship examined in the United Kingdom or Ireland.",
  MRCP: "Member of the Royal College of Physicians - a physician's postgraduate qualification examined in the United Kingdom.",
};

/** "M.B.B.S , M.D" -> ["MBBS", "MD"]. The desk types these many ways. */
const normaliseDegree = (raw: string) => raw.replace(/[.\s]/g, "").toUpperCase();

/**
 * What to bring to any outpatient visit.
 *
 * Identical for every clinic in the building, which is exactly why it lives
 * here once instead of being repeated - and rephrased, and drifting - across
 * fifteen profiles.
 */
const PREPARE_FOR_ANY_CLINIC = [
  "Any medicine you are already taking - bring the strips or the box, not just the names",
  "Previous prescriptions, discharge summaries and scan or blood reports, even old ones",
  "Your Jeeva hospital ID if you have been here before, so the doctor sees your full history",
  "Insurance or scheme card, if you intend to use one",
  "A family member who knows the history, if the patient is elderly or unwell",
];

/**
 * Consulting days, said the way a patient reads them.
 *
 * Seven days becomes "Daily" rather than "Sun, Mon, Tue, Wed, Thu, Fri, Sat",
 * and a run becomes "Mon - Sat". Anything irregular is listed plainly, because
 * compressing "Mon, Wed, Fri" into a range would be a lie about when to come.
 */
function describeDays(days: number[]): string {
  const set = [...new Set(days)].sort((a, b) => a - b);
  if (!set.length) return "By appointment";
  if (set.length === 7) return "Daily";

  // Mon-Sat reads as a range; Sunday sorting to index 0 would break it, so the
  // run is detected on the Monday-first order a patient thinks in.
  const monFirst = set.map((d) => (d === 0 ? 7 : d)).sort((a, b) => a - b);
  const isRun = monFirst.every((d, i) => i === 0 || d === monFirst[i - 1] + 1);
  const label = (d: number) => DAY_LABEL[d === 7 ? 0 : d];
  if (isRun && monFirst.length > 2) return `${label(monFirst[0])} - ${label(monFirst[monFirst.length - 1])}`;
  return monFirst.map(label).join(", ");
}

/**
 * Consulting hours.
 *
 * A round-the-clock schedule is stored as 00:00-24:00, which is technically
 * accurate and useless on a card - "Open 24 Hours" is what the hospital already
 * says everywhere else, so that is what this says.
 */
function describeHours(schedules: { startTime: string; endTime: string }[]): string {
  if (!schedules.length) return "By appointment";
  const starts = [...new Set(schedules.map((s) => s.startTime))];
  const ends = [...new Set(schedules.map((s) => s.endTime))];
  if (starts.length === 1 && ends.length === 1) {
    const [from, to] = [starts[0], ends[0]];
    if (from === "00:00" && (to === "24:00" || to === "23:59")) return "Open 24 Hours";
    return `${from} - ${to}`;
  }
  // Hours that differ by day: give the outer envelope rather than a wrong single
  // window, and let the profile page's day-by-day table carry the detail.
  const from = starts.sort()[0];
  const to = ends.sort()[ends.length - 1];
  return from === "00:00" && (to === "24:00" || to === "23:59") ? "Open 24 Hours" : `${from} - ${to}`;
}

/** Degrees off the record, explained where the degree is one we know. */
function credentialsFrom(qualification: string | null): Credential[] {
  if (!qualification?.trim()) return [];
  return qualification
    .split(",")
    .map((part) => part.trim().replace(/[,\s]+$/, ""))
    .filter(Boolean)
    .map((award) => {
      const note = DEGREE_MEANING[normaliseDegree(award)];
      return note ? { award, note } : { award };
    });
}

type DoctorRow = {
  id: string;
  name: string;
  specialization: string;
  department: string;
  consultationFee: unknown;
  qualification: string | null;
  experienceYears: number | null;
  age: number | null;
  languages: string | null;
  bio: string | null;
  schedules: { dayOfWeek: number; startTime: string; endTime: string }[];
};

function toPublicDoctor(d: DoctorRow): Doctor {
  const dept = DEPARTMENTS.find((x) => x.name === d.department);
  const services = dept?.services ?? [];

  return {
    // The cuid, not the name. The booking and callback forms post this straight
    // through to a lookup on Doctor.id - which is the whole reason the callback
    // form used to 404 on every named doctor.
    id: d.id,
    name: d.name,
    specialization: d.specialization,
    // The ERP has no separate door-title, and inventing one ("Senior Consultant")
    // would be a promotion nobody granted. The speciality is what the door says.
    designation: d.specialization,
    department: d.department,
    qualification: d.qualification?.trim() || "MBBS",
    experience: d.experienceYears ?? 0,
    age: d.age ?? 0,
    fee: Number(d.consultationFee),
    opd: describeHours(d.schedules),
    days: describeDays(d.schedules.map((s) => s.dayOfWeek)),
    room: dept ? `OPD Block · ${dept.name}` : "OPD Block · Reception will direct you",
    bio: d.bio?.trim() || dept?.blurb || "",
    // Departmental, and said as such. What a general medicine clinic sees is
    // true of every general physician sitting in it.
    about: dept?.guidance.about ? [dept.guidance.about] : [],
    languages: d.languages?.trim() || "Telugu, English",
    focus: services.slice(0, 4).map((s) => s.name),
    treats: services.map((s) => s.name),
    prepare: PREPARE_FOR_ANY_CLINIC,
    education: credentialsFrom(d.qualification),
    // Nobody has supplied these. The profile page skips each empty section
    // rather than printing a heading over nothing.
    procedures: [],
    interests: [],
    seeIf: [],
  };
}

/**
 * The panel, active consultants only, ordered by department then name.
 *
 * `cache` dedupes this within a single render - the doctors page, its metadata
 * export and its JSON-LD all ask for the same list and get one query.
 */
export const listPublicDoctors = cache(async (): Promise<Doctor[]> => {
  const rows = await prisma.doctor.findMany({
    where: { active: true },
    orderBy: [{ department: "asc" }, { name: "asc" }],
    select: {
      id: true, name: true, specialization: true, department: true,
      consultationFee: true, qualification: true, experienceYears: true,
      age: true, languages: true, bio: true,
      schedules: { where: { isActive: true }, select: { dayOfWeek: true, startTime: true, endTime: true } },
    },
  });
  return rows.map(toPublicDoctor);
});

/** One consultant by cuid, or undefined. Reads the cached list, not a new query. */
export async function findPublicDoctor(id: string): Promise<Doctor | undefined> {
  return (await listPublicDoctors()).find((d) => d.id === id);
}

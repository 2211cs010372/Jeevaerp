import type { Doctor } from "./data";

/**
 * One matcher, used by BOTH the navbar typeahead and the /doctors directory.
 *
 * They must agree. The navbar previously only routed to /doctors?q=… and the
 * directory only matched name and speciality - so typing something a patient
 * would actually type ("knee pain", "vaccination", "Telugu") suggested nothing
 * and then landed on "No doctors match that". A search box that finds nothing
 * for real words teaches people the site has no doctors.
 *
 * Patients search by the problem, not by the department. So the haystack
 * includes what each consultant actually treats (`focus`), alongside name,
 * speciality, department, qualification and the languages they consult in -
 * that last one matters here, where a family may be looking for someone they
 * can describe symptoms to in Telugu.
 */

/** Where a match was found, ranked. Lower sorts first. */
const RANK = {
  nameStart: 0,
  name: 1,
  specialityStart: 2,
  speciality: 3,
  department: 4,
  focus: 5,
  qualification: 6,
  language: 7,
} as const;

const norm = (s: string) => s.toLowerCase().trim();

/** The single field that best explains why a doctor matched, for the UI to show. */
export interface DoctorMatch {
  doctor: Doctor;
  /** Short human label - "Treats knee pain", "Speaks Telugu". Null for a plain name hit. */
  reason: string | null;
}

function score(d: Doctor, q: string): { rank: number; reason: string | null } | null {
  const name = norm(d.name);
  const spec = norm(d.specialization);
  const dept = norm(d.department);

  // A leading "dr" / "dr." is noise - everyone's name starts with it.
  const bare = name.replace(/^dr\.?\s*/, "");

  if (name.startsWith(q) || bare.startsWith(q)) return { rank: RANK.nameStart, reason: null };
  if (name.includes(q)) return { rank: RANK.name, reason: null };
  if (spec.startsWith(q)) return { rank: RANK.specialityStart, reason: null };
  if (spec.includes(q)) return { rank: RANK.speciality, reason: null };
  if (dept.includes(q)) return { rank: RANK.department, reason: `Department of ${d.department}` };

  const focus = d.focus.find((f) => norm(f).includes(q));
  if (focus) return { rank: RANK.focus, reason: `Treats ${focus.toLowerCase()}` };

  if (norm(d.qualification).includes(q)) return { rank: RANK.qualification, reason: d.qualification };

  const lang = d.languages.split(",").map((l) => l.trim()).find((l) => norm(l).includes(q));
  if (lang) return { rank: RANK.language, reason: `Consults in ${lang}` };

  return null;
}

/**
 * Ranked matches for a free-text query. An empty query returns everything, in
 * the panel's own order - the directory renders that as its default list.
 */
export function searchDoctors(doctors: Doctor[], query: string): DoctorMatch[] {
  const q = norm(query);
  if (!q) return doctors.map((doctor) => ({ doctor, reason: null }));

  return doctors
    .map((doctor) => {
      const hit = score(doctor, q);
      return hit ? { doctor, reason: hit.reason, rank: hit.rank } : null;
    })
    .filter((x): x is { doctor: Doctor; reason: string | null; rank: number } => x !== null)
    .sort((a, b) => a.rank - b.rank || a.doctor.name.localeCompare(b.doctor.name))
    .map(({ doctor, reason }) => ({ doctor, reason }));
}

import type { Doctor } from "@/lib/data";

/**
 * One photograph per speciality, for consultant cards whose doctor has no
 * photo of their own yet.
 *
 * Every one is a picture of the WORK - an ultrasound print, a lung model, a
 * tray of instruments - and none shows a face. That is the whole rule: a face
 * on a card under a real consultant's name is read as that consultant, and a
 * patient will look for it in the corridor. A stethoscope claims nothing.
 *
 * Licensed stock (Unsplash), 3840px masters in /public/images/specialities,
 * resized per request by next/image. Departments without their own picture
 * fall back to the general-medicine stethoscope.
 */
const BY_DEPARTMENT: Record<string, string> = {
  Anaesthesiology: "anaesthesiology",
  "General Medicine": "general-medicine",
  Gastroenterologist: "gastroenterology",
  Gastroenterology: "gastroenterology",
  "General Surgery": "general-surgery",
  Gynaecology: "gynaecology",
  Neurology: "neurology",
  Neurosurgery: "neurosurgery",
  Orthopaedics: "orthopaedics",
  Paediatrics: "paediatrics",
  Physiotherapy: "physiotherapy",
  "Plastic Surgery": "plastic-surgery",
  Psychiatry: "psychiatry",
  Pulmonology: "pulmonology",
  Urology: "urology",
};

export function specialityImage(department: string): string {
  return `/images/specialities/${BY_DEPARTMENT[department] ?? "general-medicine"}.jpg`;
}

/** The consultant's own photo when there is one, else their speciality's. */
export function doctorImage(d: Pick<Doctor, "photoUrl" | "department">): { src: string; own: boolean } {
  return d.photoUrl ? { src: d.photoUrl, own: true } : { src: specialityImage(d.department), own: false };
}

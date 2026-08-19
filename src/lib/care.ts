import { CARE_AREAS, DEPARTMENTS, type CareArea, type Department, type Doctor } from "./data";

/**
 * Care-area routing.
 *
 * Departments are the clinical truth; care areas are the doors people walk
 * through. Both need stable URLs, and both the navbar, the 404, the sitemap
 * and the pages themselves have to agree on what those URLs are - so the
 * slugging lives here rather than being re-derived in five places.
 */

/** "General Medicine" -> "general-medicine" */
export function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export const departmentSlugs = () => DEPARTMENTS.map((d) => slugify(d.name));

export function departmentBySlug(slug: string): Department | undefined {
  return DEPARTMENTS.find((d) => slugify(d.name) === slug);
}

/** The care area a department sits under - used for the page's eyebrow. */
export function careAreaFor(departmentName: string): CareArea | undefined {
  return CARE_AREAS.find((a) => a.departments.includes(departmentName));
}

export function doctorsIn(doctors: Doctor[], departmentName: string): Doctor[] {
  return doctors.filter((d) => d.department === departmentName);
}

/** Where a navbar service item should land. */
export const careHref = (departmentName: string) => `/care/${slugify(departmentName)}`;

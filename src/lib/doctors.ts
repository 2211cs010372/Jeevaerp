import type { Doctor } from "./data";
import { slugify } from "./care";

/**
 * Doctor URLs.
 *
 * A consultant's `id` is the ERP's cuid - meaningless to a patient and to a
 * search engine. Earlier rosters put the full name there instead, giving
 *
 *     /doctors/Dr.%20A.%20Shanthosh
 *
 * which is ugly in a search result, breaks the moment somebody pastes it into
 * WhatsApp, and puts a dot and two spaces inside a path segment that CDNs and
 * link parsers are entitled to treat as a file extension.
 *
 * So the URL is a slug derived from the NAME - /doctors/dr-a-shanthosh - and it
 * survives the id changing shape again, which it has already done once.
 *
 * `doctorByParam` is deliberately generous about what it will accept: the slug,
 * the raw id, or the name in any casing or encoding. Old links, pasted links
 * and half-typed links all resolve, and the page then redirects to the one
 * canonical address so only one of them is ever indexed.
 */

/** "Dr. A. Shanthosh" -> "dr-a-shanthosh". */
export const doctorSlug = (d: Doctor): string => slugify(d.name);

/** Where a link to this consultant should point. */
export const doctorHref = (d: Doctor): string => `/doctors/${doctorSlug(d)}`;

/** URL segments that fail to decode are user input, not a crash. */
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Resolve a URL segment to a consultant - by slug, by id, or by name.
 * Returns undefined when nothing matches, which is the page's 404.
 *
 * The panel is passed in rather than imported. It comes from the database now
 * (see server/services/public-doctors.service.ts), and a module that reaches
 * for Prisma is a module no client component can import - which this one is,
 * through `doctorHref`.
 */
export function doctorByParam(doctors: Doctor[], param: string): Doctor | undefined {
  const raw = safeDecode(param).trim();
  const key = slugify(raw);
  if (!key) return undefined;

  return (
    doctors.find((d) => doctorSlug(d) === key) ??
    doctors.find((d) => d.id === raw) ??
    doctors.find((d) => slugify(d.id) === key)
  );
}

/** True when the visitor arrived on something other than the canonical URL. */
export const isCanonicalParam = (param: string, doctor: Doctor): boolean =>
  param === doctorSlug(doctor);

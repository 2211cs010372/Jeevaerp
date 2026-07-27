import { HOSPITAL } from "./data";

/**
 * Where this site lives, for anything that needs an absolute URL: canonical
 * tags, OpenGraph images, the sitemap, and JSON-LD.
 *
 * Relative OG URLs are silently dropped by most scrapers, so getting this
 * wrong means links shared on WhatsApp show a bare address instead of a card.
 * Override with NEXT_PUBLIC_SITE_URL per environment (previews, staging).
 */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.jeevamultispecialityhospital.com"
).replace(/\/$/, "");

export const abs = (path: string) => `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;

/** The hospital as a machine-readable record - address, hours, phone. */
export function hospitalJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "Hospital",
    "@id": `${SITE_URL}/#hospital`,
    name: HOSPITAL.name,
    alternateName: HOSPITAL.shortName,
    description:
      "Multispeciality hospital in Hanamkonda with 24×7 emergency, eight departments, in-house diagnostics and pharmacy.",
    url: SITE_URL,
    telephone: HOSPITAL.phone,
    email: HOSPITAL.email,
    address: {
      "@type": "PostalAddress",
      streetAddress: HOSPITAL.address,
      addressLocality: "Hanamkonda",
      addressRegion: "Telangana",
      postalCode: "506001",
      addressCountry: "IN",
    },
    // OPD hours, seven days - Sunday included, matching the consulting diary
    // every doctor now carries. This listed Mon-Sat while the booking grid sold
    // Sunday slots, which is the kind of drift that has a family arrive on a
    // day Google told them the hospital was shut.
    // The emergency department is separate and never closes.
    openingHoursSpecification: [
      {
        "@type": "OpeningHoursSpecification",
        dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
        opens: "08:00",
        closes: "20:00",
      },
    ],
    availableService: { "@type": "MedicalProcedure", name: "Emergency care", availableChannel: { "@type": "ServiceChannel", servicePhone: HOSPITAL.emergency } },
    medicalSpecialty: [
      "Cardiology", "Orthopedic", "Gynecologic", "Pediatric",
      "PrimaryCare", "Neurologic", "Dermatology", "Otolaryngologic",
    ],
  };
}

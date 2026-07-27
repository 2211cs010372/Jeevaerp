import type { Metadata } from "next";
import { Suspense } from "react";
import { SectionHeading } from "@/components/ui/section-heading";
import { DoctorsDirectory } from "@/components/marketing/doctors-directory";
import { DOCTORS, DEPARTMENTS, HOSPITAL } from "@/lib/data";
import { SITE_URL, abs } from "@/lib/site";

const TITLE = "Our doctors";
const DESCRIPTION =
  `${DOCTORS.length} consultants across ${DEPARTMENTS.length} departments at Jeeva Multispeciality Hospital, Hanamkonda. `
  + "See each doctor's OPD hours, consulting days and fee, then book online.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  // Without a canonical, /doctors?q=… and /doctors?dept=… are indexed as
  // separate pages competing with the one that should rank.
  alternates: { canonical: "/doctors" },
  keywords: [
    "doctors in Hanamkonda", "best hospital Warangal", "book doctor appointment Hanamkonda",
    ...DEPARTMENTS.map((d) => `${d.name.toLowerCase()} doctor Hanamkonda`),
  ],
  openGraph: {
    type: "website",
    title: TITLE,
    description: DESCRIPTION,
    url: "/doctors",
    siteName: HOSPITAL.name,
    locale: "en_IN",
    images: [{ url: DOCTORS[0]?.image ?? "/images/jeeva-logo.png", alt: `Consultants at ${HOSPITAL.name}` }],
  },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

/**
 * The panel as a machine-readable list. An ItemList of Physician entries lets a
 * search engine understand this as a roster rather than as one long page of
 * text, and is what makes individual consultants eligible to surface for
 * "<speciality> doctor Hanamkonda" without each profile having to be crawled
 * first.
 */
function doctorsListJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    "@id": `${SITE_URL}/doctors#roster`,
    name: `Consultants at ${HOSPITAL.name}`,
    description: DESCRIPTION,
    numberOfItems: DOCTORS.length,
    itemListElement: DOCTORS.map((d, i) => ({
      "@type": "ListItem",
      position: i + 1,
      url: abs(`/doctors/${d.id}`),
      item: {
        "@type": "Physician",
        "@id": abs(`/doctors/${d.id}#physician`),
        name: d.name,
        medicalSpecialty: d.specialization,
        image: abs(d.image),
        url: abs(`/doctors/${d.id}`),
        knowsLanguage: d.languages.split(",").map((l) => l.trim()),
        worksFor: { "@type": "Hospital", name: HOSPITAL.name, url: SITE_URL },
      },
    })),
  };
}

export default function DoctorsPage() {
  return (
    <div className="pb-8">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(doctorsListJsonLd()) }}
      />
      <SectionHeading
        index="Our doctors"
        title="Find the right specialist."
        subtitle="Open a profile to see when a consultant actually sits, what they treat and what the visit costs - then book the slot that suits you."
      />
      <div className="mt-10">
        {/* the directory reads ?q= and ?dept=, so it needs a boundary */}
        <Suspense fallback={<div className="mx-auto max-w-[1200px] px-5 py-20 text-center text-[14px] text-[var(--muted)] lg:px-8">Loading doctors…</div>}>
          <DoctorsDirectory doctors={DOCTORS} />
        </Suspense>
      </div>
    </div>
  );
}

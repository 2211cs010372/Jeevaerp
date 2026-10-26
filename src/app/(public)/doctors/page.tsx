import type { Metadata } from "next";
import { Suspense } from "react";
import { PosterIntro } from "@/components/marketing/poster-intro";
import { DoctorsDirectory } from "@/components/marketing/doctors-directory";
import { DEPARTMENTS, HOSPITAL } from "@/lib/data";
import { listPublicDoctors } from "@/server/services/public-doctors.service";
import { SITE_URL, abs } from "@/lib/site";
import { doctorHref } from "@/lib/doctors";
import type { Doctor } from "@/lib/data";

const TITLE = "Our doctors";
const DESCRIPTION =
  `Consultants across ${DEPARTMENTS.length} departments at Jeeva Multispeciality Hospital, Hanamkonda. `
  + "See each doctor's OPD hours and consulting days, then book online.";

// A count belongs in the copy only if it is the count. The panel is read from
// the ERP now and changes when the hospital hires; a number frozen into a
// static metadata export would be wrong the first time it did.
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
    images: [{ url: "/images/jeeva-logo.png", alt: `Consultants at ${HOSPITAL.name}` }],
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
function doctorsListJsonLd(doctors: Doctor[]) {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    "@id": `${SITE_URL}/doctors#roster`,
    name: `Consultants at ${HOSPITAL.name}`,
    description: DESCRIPTION,
    numberOfItems: doctors.length,
    itemListElement: doctors.map((d, i) => ({
      "@type": "ListItem",
      position: i + 1,
      url: abs(doctorHref(d)),
      item: {
        "@type": "Physician",
        "@id": abs(`${doctorHref(d)}#physician`),
        name: d.name,
        medicalSpecialty: d.specialization,
        url: abs(doctorHref(d)),
        knowsLanguage: d.languages.split(",").map((l) => l.trim()),
        worksFor: { "@type": "Hospital", name: HOSPITAL.name, url: SITE_URL },
      },
    })),
  };
}

export default async function DoctorsPage() {
  const doctors = await listPublicDoctors();
  return (
    <div className="f-sans bg-white px-[1.5rem] pb-[clamp(3.5rem,7vw,6rem)] pt-[calc(var(--nav-h)+1.5rem)]">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(doctorsListJsonLd(doctors)) }}
      />

      {/* the homepage's chapter opening, as this page's title */}
      <PosterIntro
        as="h1"
        index={String(doctors.length)}
        label="Consultants"
        aside={[`${new Set(doctors.map((d) => d.department)).size} departments.`, "One building.", "No pooled queue."]}
        lede="Open a profile to see when a consultant actually sits and what they treat - then book the slot that suits you. The doctor you pick is the doctor who sees you."
        action={{ href: "/book", label: "Book an appointment" }}
        lines={[{ text: "Find the right" }, { text: "specialist.", className: "italic text-[var(--teal)]" }]}
      />

      <div className="mt-[clamp(2rem,4vw,3rem)]">
        {/* the directory reads ?q= and ?dept=, so it needs a boundary */}
        <Suspense
          fallback={
            <p className="py-20 text-center text-[13px] font-medium text-[var(--muted)]">Loading doctors…</p>
          }
        >
          <DoctorsDirectory doctors={doctors} />
        </Suspense>
      </div>
    </div>
  );
}

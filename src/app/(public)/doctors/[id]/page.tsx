import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { HOSPITAL } from "@/lib/data";
import { listPublicDoctors } from "@/server/services/public-doctors.service";
import { DoctorProfile } from "@/components/marketing/doctor-profile";
import { SITE_URL, abs } from "@/lib/site";
import { doctorByParam, doctorHref, doctorSlug, isCanonicalParam } from "@/lib/doctors";

/** The panel is read once at build time, so every profile is static HTML and a
 *  patient's first paint costs no database round trip. A consultant added at
 *  the reception desk appears on the next deploy, or on revalidation.
 *  The param is the NAME SLUG, never the raw id - see lib/doctors.ts. */
export async function generateStaticParams() {
  try {
    return (await listPublicDoctors()).map((d) => ({ id: doctorSlug(d) }));
  } catch {
    return [];
  }
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const doctor = doctorByParam(await listPublicDoctors(), id);
  if (!doctor) return { title: "Doctor not found" };
  // Always the canonical slug, never whatever spelling the visitor arrived on -
  // two URLs for one consultant is two half-ranked pages instead of one.
  const href = doctorHref(doctor);
  const title = `${doctor.name} · ${doctor.specialization}`;
  const description = `${doctor.name}, ${doctor.designation} at Jeeva Multispeciality Hospital, Hanamkonda. ${doctor.qualification}, ${doctor.experience} years in practice. Treats ${doctor.treats.slice(0, 4).join(", ").toLowerCase()}. OPD ${doctor.opd}, ${doctor.days}. Consultation ₹${doctor.fee}. Book an appointment online.`;
  return {
    title,
    description,
    // What this consultant actually treats is what people type into a search
    // box - far more often than their name, which they don't know yet. The
    // full `treats` list is the long tail of that: "kidney stone doctor
    // Hanamkonda" is a real query in a way that "urologist" is not.
    keywords: [
      doctor.name,
      `${doctor.specialization} in Hanamkonda`,
      `${doctor.department} doctor Warangal`,
      ...doctor.treats.slice(0, 8).map((t) => `${t} treatment Hanamkonda`),
    ],
    alternates: { canonical: href },
    // No portrait: the hospital has not photographed its panel, and the stock
    // faces that used to fill this slot were shown under real doctors' names.
    // The site mark is honest and still renders a card in a WhatsApp preview.
    openGraph: {
      type: "profile",
      title,
      description,
      url: href,
      siteName: HOSPITAL.name,
      locale: "en_IN",
      images: [{ url: "/images/jeeva-logo.png", alt: `${doctor.name}, ${doctor.specialization}` }],
    },
    twitter: { card: "summary", title, description },
  };
}

export default async function DoctorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const panel = await listPublicDoctors();
  const doctor = doctorByParam(panel, id);
  if (!doctor) notFound();

  // A link with the raw id or the un-slugged name in it - an old bookmark, a
  // pasted address bar - resolves, then moves to the address we publish.
  if (!isCanonicalParam(id, doctor)) permanentRedirect(doctorHref(doctor));

  // Jeeva currently runs one consultant per department, so a strict
  // same-department list would always be empty and the section would never
  // render. Fall back to the rest of the panel, relabelled honestly.
  const sameDept = panel.filter((d) => d.department === doctor.department && d.id !== doctor.id);
  const peers = (sameDept.length ? sameDept : panel.filter((d) => d.id !== doctor.id)).slice(0, 4);

  return (
    <>
      {/* Physician schema - puts the consultant, their speciality and the
          hospital's address straight into search results. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Physician",
            // Same @id the /doctors ItemList points at, so the roster entry and
            // this page resolve to one entity rather than two rival records.
            "@id": abs(`${doctorHref(doctor)}#physician`),
            name: doctor.name,
            jobTitle: doctor.designation,
            medicalSpecialty: doctor.specialization,
            description: doctor.bio,
            url: abs(doctorHref(doctor)),
            knowsLanguage: doctor.languages.split(",").map((l) => l.trim()),
            // Degrees the hospital holds on record, and nothing else - the
            // credential fields in data.ts explain why nothing personal is
            // asserted here.
            hasCredential: doctor.education.map((e) => ({
              "@type": "EducationalOccupationalCredential",
              credentialCategory: "degree",
              name: e.award,
            })),
            // What they do, separated from what they see: a procedure and a
            // condition are different things to a search engine, and lumping
            // them together is how a hospital ends up listed as "treating"
            // an operation.
            availableService: doctor.procedures.map((p) => ({
              "@type": "MedicalProcedure",
              name: p.name,
              description: p.desc,
            })),
            knowsAbout: doctor.treats,
            makesOffer: {
              "@type": "Offer",
              name: "Outpatient consultation",
              price: doctor.fee,
              priceCurrency: "INR",
            },
            worksFor: { "@type": "Hospital", name: HOSPITAL.name, url: SITE_URL },
            address: {
              "@type": "PostalAddress",
              streetAddress: HOSPITAL.address,
              addressLocality: "Hanamkonda",
              addressRegion: "Telangana",
              postalCode: "506001",
              addressCountry: "IN",
            },
            telephone: HOSPITAL.phone,
          }),
        }}
      />
      <DoctorProfile
        doctor={doctor}
        peers={peers}
        peersLabel={sameDept.length ? `Also in ${doctor.department}` : "Other specialists"}
      />
    </>
  );
}

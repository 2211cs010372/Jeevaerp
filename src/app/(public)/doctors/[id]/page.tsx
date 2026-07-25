import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DOCTORS, HOSPITAL } from "@/lib/data";
import { DoctorProfile } from "@/components/marketing/doctor-profile";
import { SITE_URL, abs } from "@/lib/site";

/** Eight consultants, known at build time - so every profile is static HTML. */
export function generateStaticParams() {
  return DOCTORS.map((d) => ({ id: d.id }));
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const doctor = DOCTORS.find((d) => d.id === id);
  if (!doctor) return { title: "Doctor not found" };
  const title = `${doctor.name} · ${doctor.specialization}`;
  const description = `${doctor.name}, ${doctor.specialization} at Jeeva Multispeciality Hospital, Hanamkonda. ${doctor.qualification}. OPD ${doctor.opd}, ${doctor.days}. Book an appointment online.`;
  return {
    title,
    description,
    alternates: { canonical: `/doctors/${id}` },
    openGraph: {
      type: "profile",
      title,
      description,
      url: `/doctors/${id}`,
      images: [{ url: doctor.image, alt: doctor.name }],
    },
    twitter: { card: "summary_large_image", title, description, images: [doctor.image] },
  };
}

export default async function DoctorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const doctor = DOCTORS.find((d) => d.id === id);
  if (!doctor) notFound();

  // Jeeva currently runs one consultant per department, so a strict
  // same-department list would always be empty and the section would never
  // render. Fall back to the rest of the panel, relabelled honestly.
  const sameDept = DOCTORS.filter((d) => d.department === doctor.department && d.id !== doctor.id);
  const peers = sameDept.length
    ? sameDept
    : DOCTORS.filter((d) => d.id !== doctor.id).slice(0, 3);

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
            name: doctor.name,
            medicalSpecialty: doctor.specialization,
            description: doctor.bio,
            image: abs(doctor.image),
            url: abs(`/doctors/${doctor.id}`),
            knowsLanguage: doctor.languages.split(",").map((l) => l.trim()),
            availableService: doctor.focus.map((f) => ({ "@type": "MedicalProcedure", name: f })),
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

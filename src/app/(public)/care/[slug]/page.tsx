import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CarePage } from "@/components/marketing/care-page";
import { departmentBySlug, departmentSlugs, careAreaFor, doctorsIn } from "@/lib/care";
import { HOSPITAL } from "@/lib/data";

/** Eight departments, known at build time - every page is static HTML. */
export function generateStaticParams() {
  return departmentSlugs().map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const dept = departmentBySlug(slug);
  if (!dept) return { title: "Department not found" };

  const title = `${dept.name} in ${HOSPITAL.locality.split(",")[0]}`;
  // .map(s => s.name) matters: joining the objects themselves compiles fine
  // and quietly ships "[object Object]" into the search snippet.
  const description = `${dept.blurb} ${dept.services.slice(0, 5).map((s) => s.name).join(", ")} and more at ${HOSPITAL.name}.`;
  return {
    title,
    description,
    alternates: { canonical: `/care/${slug}` },
    openGraph: { title, description, type: "website", url: `/care/${slug}` },
  };
}

export default async function DepartmentPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const dept = departmentBySlug(slug);
  if (!dept) notFound();

  return (
    <CarePage
      dept={dept}
      area={careAreaFor(dept.name)}
      doctors={doctorsIn(dept.name)}
    />
  );
}

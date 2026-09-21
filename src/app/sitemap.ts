import type { MetadataRoute } from "next";
import { listPublicDoctors } from "@/server/services/public-doctors.service";
import { departmentSlugs } from "@/lib/care";
import { SITE_URL } from "@/lib/site";
import { doctorHref } from "@/lib/doctors";

/**
 * Every public page, so the doctor profiles and department pages are
 * discoverable. The staff portals are deliberately absent - they're excluded
 * in robots.ts too, and nothing behind a login belongs in a sitemap.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  let doctors: Awaited<ReturnType<typeof listPublicDoctors>> = [];
  try {
    doctors = await listPublicDoctors();
  } catch {
    doctors = [];
  }
  const now = new Date();

  const staticPages = [
    { path: "/", priority: 1, freq: "weekly" as const },
    { path: "/doctors", priority: 0.9, freq: "weekly" as const },
    { path: "/book", priority: 0.9, freq: "monthly" as const },
    { path: "/health-checks", priority: 0.8, freq: "monthly" as const },
  ];

  return [
    ...staticPages.map((p) => ({
      url: `${SITE_URL}${p.path}`,
      lastModified: now,
      changeFrequency: p.freq,
      priority: p.priority,
    })),
    ...departmentSlugs().map((slug) => ({
      url: `${SITE_URL}/care/${slug}`,
      lastModified: now,
      changeFrequency: "monthly" as const,
      priority: 0.8,
    })),
    ...doctors.map((d) => ({
      url: `${SITE_URL}${doctorHref(d)}`,
      lastModified: now,
      changeFrequency: "monthly" as const,
      priority: 0.7,
    })),
  ];
}

import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";
import { PORTAL_SUBDOMAINS } from "@/lib/auth/host";

/**
 * The marketing site is open; everything that needs a login is not.
 *
 * The portal paths carry patient data behind auth - they'd never serve a
 * crawler anything, but keeping them out of the index also keeps staff login
 * screens off search results, where they only ever attract the wrong traffic.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/api/",
          // Every portal except "doctor", which needs the anchored form below.
          // Derived from the one portal list rather than retyped: this file was
          // the last copy still listing them by hand, and it silently left the
          // newest portal's login screen crawlable.
          ...PORTAL_SUBDOMAINS.filter((p) => p !== "doctor").map((p) => `/${p}`),
          // CAREFUL: Disallow is a PREFIX match, so a bare "/doctor" would also
          // block "/doctors" and every doctor profile - the exact pages this
          // site most wants indexed. Anchor the portal path instead.
          "/doctor$", "/doctor/",
          "/portal/profile",
          "/print/",
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
